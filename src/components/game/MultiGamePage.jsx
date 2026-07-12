import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  SQBoardShell,
  SQLobbyHeader,
  SQBoardHeader,
  SQSettingsRow,
} from '../../../../rae-side-quest/packages/sq-ui'
import AvatarMenu from '../lobby/AvatarMenu.jsx'
import HeaderRight from '../HeaderRight.jsx'
import { CATEGORIES, wordScore } from '../../lib/scoring.js'
import { DIE_COUNT, ROLLS_PER_TURN } from '../../lib/dice.js'
import { useRealtimeChannel } from '../../hooks/useRealtimeChannel.js'
import { useDictionary } from '../../hooks/useDictionary.js'
import { evaluateScoreAttempt } from '../../lib/scoreValidation.js'
import { supabase } from '../../lib/supabase.js'
import {
  loadGame,
  loadPlayers,
  loadMyTurnState,
  rollDice,
  parkDie,
  unparkDie,
  swapLetters,
  scoreCategory,
  takeZero,
  clearBuilder as clearBuilderRpc,
  forfeitGame,
  claimInactiveWin,
  rematch,
  requestRematch,
  acceptRematch,
  declineRematch,
  acceptInvite,
  cancelInvite,
  joinOpenGame,
} from '../../lib/multiplayerActions.js'
import OpponentScoreSheet from './OpponentScoreSheet.jsx'
import GameOverComparison from './GameOverComparison.jsx'
import Scorecard from './Scorecard.jsx'
import WordBuilder from './WordBuilder.jsx'
import DiceRack from './DiceRack.jsx'

const TOTAL_TURNS = CATEGORIES.length

// Pad/truncate the server's faces array to length DIE_COUNT (server returns
// `[]` until the first roll). Lets DiceRack render a stable 6-slot rack.
function normalizeFaces(faces) {
  const out = new Array(DIE_COUNT).fill(null)
  if (!faces) return out
  for (let i = 0; i < DIE_COUNT; i++) {
    if (faces[i] != null) out[i] = faces[i]
  }
  return out
}

export default function MultiGamePage({ session, profile, isAdmin }) {
  const { gameId } = useParams()
  const navigate = useNavigate()
  const userId = session?.user?.id

  const [game, setGame] = useState(null)
  const [players, setPlayers] = useState([])
  const [oppProfiles, setOppProfiles] = useState({})
  // For waiting-state screens (invite not yet accepted) the opponent
  // isn't in yahdle_players yet — resolve their profile from the game
  // row's created_by / invited_user_id instead.
  const [waitingOtherProfile, setWaitingOtherProfile] = useState(null)
  const [inviteBusy, setInviteBusy] = useState(false)
  // Auto-accept-on-arrival: when an invitee deep-links into a waiting
  // game (push-notification tap), accept the invite once without
  // prompting. Tapping the notification is already consent. Matches
  // the pattern used by Wordy / Snibble / Rungles. Tracks the gameId
  // we last attempted so retries on the same id don't spam.
  const autoAcceptAttempted = useRef(null)
  const [myTurnState, setMyTurnState] = useState({ faces: [], builder: [], rolls_used: 0 })
  const [zeroAskCategory, setZeroAskCategory] = useState(null)
  const [swapIdx, setSwapIdx] = useState(null)
  const [busy, setBusy] = useState(false)
  const [oppSheetId, setOppSheetId] = useState(null)
  const [rematchBusy, setRematchBusy] = useState(false)
  // Guards the requester's one-shot auto-jump into the accepted game.
  const rematchNavigated = useRef(false)
  const [animating, setAnimating] = useState(() => new Array(DIE_COUNT).fill(false))
  const { dict, dictReady } = useDictionary()

  const myPlayer = players.find(p => p.user_id === userId)
  const opponents = players
    .filter(p => p.user_id !== userId)
    .sort((a, b) => a.player_index - b.player_index)
  const oppPlayer = opponents[0] ?? null // first opponent — waiting-state fallback only
  const isMyTurn = !!(game && myPlayer && game.status === 'active' && myPlayer.player_index === game.current_player_idx)
  const isGameOver = game?.status === 'finished'
  const isWaiting = game?.status === 'waiting'
  const iAmCreator = !!(game && userId && game.created_by === userId)
  const iAmInvitee = !!(game && userId && (game.invited_user_id === userId || (game.invited_user_ids ?? []).includes(userId)))
  const iAmPlayer = !!myPlayer
  const iForfeited = !!myPlayer?.forfeited
  const seatsFilled = players.length
  const maxSeats = game?.max_players ?? 2
  const hasOpenSeat = seatsFilled < maxSeats

  // Invited friends who never joined before the game started short-handed
  // (c150). Only meaningful once the game is past 'waiting' — while waiting
  // they're still pending, not no-shows. invited_user_ids is kept on the row
  // even after the expire sweep shrinks the seats, so we can show them as
  // greyed ✗ pills.
  const noShowIds = useMemo(() => {
    if (!game || game.status === 'waiting') return []
    const seated = new Set(players.map(p => p.user_id))
    return (game.invited_user_ids ?? []).filter(id => id && !seated.has(id))
  }, [game, players])

  const faces = useMemo(() => normalizeFaces(myTurnState.faces), [myTurnState.faces])
  const inBuilder = useMemo(() => {
    const set = new Set((myTurnState.builder ?? []).map(b => b.dieIdx))
    return new Array(DIE_COUNT).fill(false).map((_, i) => set.has(i))
  }, [myTurnState.builder])
  const builderWord = useMemo(
    () => (myTurnState.builder ?? []).map(b => b.letter).join(''),
    [myTurnState.builder]
  )
  const builderScore = wordScore(builderWord)

  const [notFound, setNotFound] = useState(false)
  // Race-protection for my turn state. The flicker has TWO independent
  // sources, so we use TWO mechanisms:
  //
  //   pendingTurnMutations: counts in-flight optimistic RPCs (park /
  //     unpark / swap / clear). While > 0, refresh() must NOT load
  //     turn_state — the RPC may not have committed server-side yet,
  //     so a read would return the pre-tap state and overwrite the
  //     optimistic update. The trigger that fires our own realtime
  //     refresh (via yahdle_games.last_activity_at) lands faster than
  //     pgrest's read-after-commit on rare occasions.
  //
  //   turnStateGen: bumped on every optimistic mutation. A refresh
  //     captures the value at start; if a mutation lands during the
  //     read, the captured value mismatches and the result is
  //     discarded. Catches the case where the user taps while a
  //     refresh is mid-flight.
  const pendingTurnMutations = useRef(0)
  const turnStateGen = useRef(0)
  // Serialize turn RPCs so e.g. park-then-unpark can't reach the server
  // out of order (was causing "Bad builder index" when the unpark hit
  // Postgres before its preceding park had committed).
  const turnMutationChain = useRef(Promise.resolve())
  const refresh = useCallback(async () => {
    if (!gameId) return
    try {
      const [g, ps] = await Promise.all([loadGame(gameId), loadPlayers(gameId)])
      if (!g) { setNotFound(true); return }
      setGame(g)
      setPlayers(ps)
      if (userId && pendingTurnMutations.current === 0) {
        const genAtStart = turnStateGen.current
        const mts = await loadMyTurnState(gameId, userId)
        if (turnStateGen.current !== genAtStart) return
        if (pendingTurnMutations.current > 0) return
        setMyTurnState(mts ?? { faces: [], builder: [], rolls_used: 0 })
      }
    } catch (err) {
      console.error('[MultiGamePage refresh]', err)
      toast.error(err.message || 'Failed to load game')
    }
  }, [gameId, userId])

  useEffect(() => { refresh() }, [refresh])

  // (Removed in c272: the 'sq:push-refresh' fast-path listened for a message
  // relayed by the game's own service worker, which no longer exists — games
  // are non-installable and carry no SW. MP updates flow via the realtime
  // socket + poll. Push is hub-centralized; there's no game-side push signal.)

  // Fetch profiles for opponents AND no-show invitees (for the greyed pills).
  const oppIdsKey = [...new Set([...opponents.map(o => o.user_id), ...noShowIds])].join(',')
  useEffect(() => {
    const ids = oppIdsKey ? oppIdsKey.split(',') : []
    if (!ids.length) { setOppProfiles({}); return }
    supabase.from('profiles').select('id, username, avatar_hue').in('id', ids)
      .then(({ data }) => {
        const m = {}
        for (const p of data ?? []) m[p.id] = p
        setOppProfiles(m)
      })
  }, [oppIdsKey])

  // In waiting state the invitee isn't in yahdle_players yet, so resolve
  // the "other party" from the game row. Whoever I am, the other party
  // is the user_id on the game row that isn't mine.
  const waitingOtherId = useMemo(() => {
    if (!isWaiting || !userId || !game) return null
    if (iAmCreator) return game.invited_user_id ?? null // null for open games
    return game.created_by
  }, [isWaiting, userId, game, iAmCreator])

  useEffect(() => {
    if (!waitingOtherId) { setWaitingOtherProfile(null); return }
    let cancelled = false
    supabase.from('profiles').select('id, username, avatar_hue').eq('id', waitingOtherId).maybeSingle()
      .then(({ data }) => { if (!cancelled) setWaitingOtherProfile(data ?? null) })
    return () => { cancelled = true }
  }, [waitingOtherId])

  // Auto-accept the invite when an invitee lands on /multi/<id> via a
  // push notification. Without this, they'd see an empty board because
  // they're not in yahdle_players yet (see c89). Fire at most once per
  // gameId, only if I'm the invitee and the game is still waiting.
  useEffect(() => {
    // Only auto-accept for an invitee who isn't already seated. A player
    // sitting in a not-yet-full game must NOT re-accept (it would error
    // "Already in this game").
    if (!gameId || !isWaiting || !iAmInvitee || iAmPlayer) return
    if (autoAcceptAttempted.current === gameId) return
    autoAcceptAttempted.current = gameId
    setInviteBusy(true)
    acceptInvite(gameId)
      .then(() => refresh())
      .catch(err => toast.error(err.message || 'Failed to accept invite'))
      .finally(() => setInviteBusy(false))
  }, [gameId, isWaiting, iAmInvitee, iAmPlayer, refresh])

  useRealtimeChannel({
    channelName: `game-yahdle-${gameId}`,
    subscriptions: gameId ? [
      { event: 'UPDATE', schema: 'public', table: 'yahdle_games', filter: `id=eq.${gameId}` },
      { event: '*', schema: 'public', table: 'yahdle_players', filter: `game_id=eq.${gameId}` },
      { event: 'UPDATE', schema: 'public', table: 'yahdle_turn_state', filter: `game_id=eq.${gameId}` },
    ] : [],
    onChange: refresh,
    // Worst-case floor when realtime (flaky on free-tier) and the push-
    // refresh both miss. Only fires while the tab is actually VISIBLE
    // (see useRealtimeChannel), so a backgrounded/hidden game costs nothing
    // — keeps free-tier egress negligible while cutting the visible-but-
    // stale wait from 15s to 6s.
    pollMs: 6_000,
    enabled: !!gameId,
  })

  // When my opponent accepts the rematch I requested, the finished game
  // gets back-linked to the new game (c165). Auto-jump the requester into
  // it — the accepter navigates directly from handleAcceptRematch. Fire
  // once; only for the player who actually requested.
  useEffect(() => {
    if (!game?.rematch_new_game_id || rematchNavigated.current) return
    if (game.rematch_requested_by !== userId) return
    rematchNavigated.current = true
    toast.success('Rematch on!')
    navigate(`/multi/${game.rematch_new_game_id}`)
  }, [game?.rematch_new_game_id, game?.rematch_requested_by, userId, navigate])

  // withBusy gates actions that need a server round-trip before the UI
  // can reflect the next state (Roll, Score). Optimistic actions
  // (park/unpark/swap/clear) update local state immediately and let the
  // server catch up — they don't go through this gate.
  async function withBusy(fn) {
    if (busy) return
    setBusy(true)
    try { await fn() }
    catch (err) { toast.error(err.message || 'Action failed') }
    finally { setBusy(false); refresh() }
  }

  function handleRoll() {
    if (!isMyTurn || (myTurnState.rolls_used ?? 0) >= ROLLS_PER_TURN) return
    if (inBuilder.every(Boolean)) return
    // Animate only the dice that will actually re-roll (matches solo).
    setAnimating(inBuilder.map(b => !b))
    setTimeout(() => setAnimating(new Array(DIE_COUNT).fill(false)), 500)
    withBusy(async () => {
      const newFaces = await trackTurnMutation(() => rollDice(gameId))
      setMyTurnState(s => ({
        ...s,
        faces: normalizeFaces(newFaces),
        rolls_used: (s.rolls_used ?? 0) + 1,
      }))
    })
  }

  // Wrap every optimistic RPC: bump gen + pending-counter immediately
  // (so concurrent refreshes skip / discard), and after the LAST
  // mutation settles, run one refresh to sync from the server.
  function trackTurnMutation(makePromise) {
    turnStateGen.current += 1
    pendingTurnMutations.current += 1
    const p = turnMutationChain.current.then(makePromise, makePromise)
    turnMutationChain.current = p.catch(() => {})
    return p.finally(() => {
      pendingTurnMutations.current = Math.max(0, pendingTurnMutations.current - 1)
      if (pendingTurnMutations.current === 0) refresh()
    })
  }

  function tapRackDie(i) {
    if (!isMyTurn) return
    const letter = faces[i]
    if (letter == null || inBuilder[i]) return
    if ((myTurnState.builder?.length ?? 0) >= DIE_COUNT) return
    setMyTurnState(s => ({ ...s, builder: [...(s.builder ?? []), { letter, dieIdx: i }] }))
    trackTurnMutation(() => parkDie(gameId, i)).catch(err => { toast.error(err.message || 'Failed'); refresh() })
  }

  function tapBuilderLetter(idx) {
    if (!isMyTurn) return
    if (swapIdx == null) { setSwapIdx(idx); return }
    if (swapIdx === idx) { setSwapIdx(null); return }
    const a = swapIdx, b = idx
    setSwapIdx(null)
    setMyTurnState(s => {
      const next = [...(s.builder ?? [])]
      const tmp = next[a]; next[a] = next[b]; next[b] = tmp
      return { ...s, builder: next }
    })
    trackTurnMutation(() => swapLetters(gameId, a, b)).catch(err => { toast.error(err.message || 'Failed'); refresh() })
  }

  function removeBuilderLetter(idx) {
    if (!isMyTurn) return
    setSwapIdx(null)
    setMyTurnState(s => ({ ...s, builder: (s.builder ?? []).filter((_, i) => i !== idx) }))
    trackTurnMutation(() => unparkDie(gameId, idx)).catch(err => { toast.error(err.message || 'Failed'); refresh() })
  }

  function clearBuilder() {
    if (!isMyTurn) return
    setSwapIdx(null)
    setMyTurnState(s => ({ ...s, builder: [] }))
    trackTurnMutation(() => clearBuilderRpc(gameId)).catch(err => { toast.error(err.message || 'Failed'); refresh() })
  }

  // Same validation flow as solo via the shared scoreValidation helper.
  function tryScore(categoryId) {
    if (!isMyTurn || isGameOver) return
    if (myPlayer?.scores?.[categoryId] != null) return
    const cat = CATEGORIES.find(c => c.id === categoryId)
    if (!cat) return
    const result = evaluateScoreAttempt({
      builderWord, builderScore, faces,
      categoryId, dict, dictReady,
    })
    if (result.kind === 'reject') { toast.error(result.reason); return }
    if (result.kind === 'ask-zero') { setZeroAskCategory(categoryId); return }
    withBusy(async () => {
      await trackTurnMutation(() => scoreCategory(gameId, categoryId, builderWord))
      toast.success(`+${builderScore} • ${cat.name}`)
    })
  }

  function confirmZero(categoryId) {
    setZeroAskCategory(null)
    withBusy(() => trackTurnMutation(() => takeZero(gameId, categoryId)))
  }

  function cancelZero() { setZeroAskCategory(null) }

  async function handleForfeit() {
    const others = opponents.filter(o => !o.forfeited).length
    const msg = others > 1
      ? "Forfeit? You'll take a loss and the others keep playing."
      : 'Forfeit this game? You’ll take a loss.'
    if (!confirm(msg)) return
    withBusy(() => forfeitGame(gameId))
  }

  async function handleClaim() {
    if (!confirm('Claim the win — your opponent has been inactive 7+ days?')) return
    withBusy(() => claimInactiveWin(gameId))
  }

  async function handleCancelInvite() {
    if (inviteBusy) return
    if (!confirm('Cancel this invite?')) return
    setInviteBusy(true)
    try {
      await cancelInvite(gameId)
      navigate('/')
    } catch (err) {
      toast.error(err.message || 'Failed to cancel')
      setInviteBusy(false)
    }
  }

  async function handleJoinOpen() {
    if (inviteBusy) return
    setInviteBusy(true)
    try {
      await joinOpenGame(gameId)
      toast.success('Game on!')
      await refresh()
    } catch (err) {
      toast.error(err.message || 'Failed to join')
    } finally {
      setInviteBusy(false)
    }
  }

  // Legacy unilateral rematch — only reached for N-player games.
  async function handleRematch() {
    try {
      await rematch(gameId)
      toast.success('Rematch invite sent!')
      navigate('/')
    } catch (err) {
      toast.error(err.message || 'Rematch failed')
    }
  }

  // 1v1 single-rematch handshake (c165).
  async function handleRequestRematch() {
    if (rematchBusy) return
    setRematchBusy(true)
    try {
      await requestRematch(gameId)
      toast.success('Rematch requested!')
      await refresh()
    } catch (err) {
      toast.error(err.message || 'Rematch failed')
    } finally {
      setRematchBusy(false)
    }
  }

  async function handleAcceptRematch() {
    if (rematchBusy) return
    setRematchBusy(true)
    try {
      const newId = await acceptRematch(gameId)
      navigate(`/multi/${newId}`)
    } catch (err) {
      toast.error(err.message || 'Rematch failed')
      setRematchBusy(false)
    }
  }

  async function handleDeclineRematch() {
    if (rematchBusy) return
    setRematchBusy(true)
    try {
      await declineRematch(gameId)
      await refresh()
    } catch (err) {
      toast.error(err.message || 'Failed')
    } finally {
      setRematchBusy(false)
    }
  }

  const myTotal = myPlayer?.total_score ?? 0
  const myName = profile?.username ?? 'You'
  const currentPlayer = players.find(p => p.player_index === game?.current_player_idx) ?? null
  const currentName = currentPlayer
    ? (currentPlayer.user_id === userId ? 'You' : (oppProfiles[currentPlayer.user_id]?.username ?? 'Opponent'))
    : ''

  // canClaim = it's the opponent's turn in an active game AND they've been idle
  // past 7 days. The cog row is always shown (below) and greyed unless this holds.
  const canClaim = (() => {
    if (!game || game.status !== 'active' || !myPlayer) return false
    if (myPlayer.player_index === game.current_player_idx) return false
    if (!game.last_activity_at) return false
    const age = Date.now() - new Date(game.last_activity_at).getTime()
    return age > 7 * 24 * 60 * 60 * 1000
  })()

  // Game-specific cog rows (Claim win / Forfeit), injected into the shared
  // settings dropdown. Claim is ALWAYS shown for an in-play game (so it's
  // consistently discoverable) and greyed out unless actually claimable.
  const cogGameRows = (!isGameOver && !iForfeited && game?.status === 'active')
    ? (close) => (
        <>
          <SQSettingsRow
            label="Claim win (opponent inactive)"
            disabled={!canClaim}
            title={canClaim
              ? 'Claim the win — opponent inactive 7+ days'
              : 'Available once your opponent has been inactive for 7 days'}
            onClick={() => { close(); handleClaim() }}
          />
          <SQSettingsRow
            label="Forfeit game"
            danger
            onClick={() => { close(); handleForfeit() }}
          />
        </>
      )
    : null

  return (
    <SQBoardShell
      width="narrow"
      header={
        <SQLobbyHeader
          title="Yahdle"
          avatarSlot={<AvatarMenu profile={profile} />}
          rightSlot={<HeaderRight isAdmin={isAdmin} gameRows={cogGameRows} />}
        />
      }
      subHeader={
        <SQBoardHeader
          backLabel="← Lobby"
          onBackClick={() => navigate('/')}
          centerSlot={
            <span className="text-sm opacity-80">
              {isGameOver
                ? 'Final'
                : game?.status === 'active'
                  ? `Turn ${game.current_turn}/${TOTAL_TURNS}`
                  : ''}
            </span>
          }
          /* Claim win + Forfeit now live in the cog menu (c153 revision) so the
             board chrome stays clean and they're identical across SQ games. */
        />
      }
    >
      <div className="py-2 px-2 space-y-2">

        {notFound && (
          <div className="card p-4 text-center text-sm opacity-80">
            This game doesn't exist or you're not a participant.
          </div>
        )}

        {/* score pills — one per player in seat order; the current
            player's pill is highlighted (✨). Tap an opponent's pill to
            see their scorecard. Shown to any seated player, including
            while the game is still filling up. */}
        {game && iAmPlayer && (
          <div className="flex flex-wrap gap-2 justify-center">
            {[...(myPlayer ? [myPlayer] : []), ...opponents]
              .sort((a, b) => a.player_index - b.player_index)
              .map(p => {
                const isMe = p.user_id === userId
                const prof = isMe ? profile : oppProfiles[p.user_id]
                const nm = isMe ? `${prof?.username ?? 'You'} (you)` : (prof?.username ?? 'Player')
                return (
                  <PlayerPill
                    key={p.user_id}
                    name={nm}
                    score={p.total_score ?? 0}
                    isCurrent={!isGameOver && game.status === 'active' && p.player_index === game.current_player_idx}
                    isWinner={isGameOver && p.is_winner}
                    isOut={p.forfeited}
                    onClick={isMe ? undefined : () => setOppSheetId(p.user_id)}
                  />
                )
              })}
            {/* No-show invitees on a short-handed game — greyed ✗ pills,
                no score (they never played), not tappable (no card). c150 */}
            {noShowIds.map(id => (
              <PlayerPill
                key={`noshow-${id}`}
                name={oppProfiles[id]?.username ?? 'Player'}
                noShow
              />
            ))}
          </div>
        )}

        {/* Join/accept prompt — only for a viewer who isn't seated yet
            (open-game joiner, or an invitee mid auto-accept). Seated
            players see the board below with a "waiting for players" panel. */}
        {isWaiting && !iAmPlayer && (
          <WaitingCard
            otherName={waitingOtherProfile?.username}
            iAmCreator={iAmCreator}
            iAmInvitee={iAmInvitee}
            iAmPlayer={iAmPlayer}
            seatsFilled={seatsFilled}
            maxSeats={maxSeats}
            hasOpenSeat={hasOpenSeat}
            inviteBusy={inviteBusy}
            onCancel={handleCancelInvite}
            onJoinOpen={handleJoinOpen}
            onBack={() => navigate('/')}
          />
        )}

        {/* Game over state */}
        {isGameOver && game && (
          <GameOverComparison
            game={game}
            players={players}
            profiles={{ ...oppProfiles, [userId]: profile }}
            myUserId={userId}
            onRematch={handleRematch}
            onRequestRematch={handleRequestRematch}
            onAcceptRematch={handleAcceptRematch}
            onDeclineRematch={handleDeclineRematch}
            rematchBusy={rematchBusy}
          />
        )}

        {/* I forfeited but the game's still going for the others. */}
        {!isGameOver && iForfeited && game?.status === 'active' && (
          <div className="card p-5 text-center space-y-2">
            <div className="text-3xl">🏳️</div>
            <div className="font-display text-xl text-wordy-700">You forfeited</div>
            <p className="text-sm opacity-70">The game's continuing without you — check back later for the final result.</p>
            <button
              type="button"
              onClick={() => navigate('/')}
              className="mt-1 text-sm px-3 py-1.5 rounded-lg border border-wordy-200 text-wordy-600 hover:bg-wordy-50"
            >
              ← Back to lobby
            </button>
          </div>
        )}

        {/* Board — shown to a seated player (who hasn't forfeited) whether
            the game is still filling (waiting) or active. While waiting, the
            scorecard is visible (disabled) and a "waiting for players" panel
            sits where the dice go; it becomes playable when the last seat fills. */}
        {!isGameOver && iAmPlayer && !iForfeited && (game?.status === 'active' || isWaiting) && (
          <>
            <Scorecard
              scores={myPlayer?.scores}
              onTryScore={tryScore}
              disabled={!isMyTurn || busy}
              zeroAskCategory={zeroAskCategory}
              onConfirmZero={confirmZero}
              onCancelZero={cancelZero}
              builderWord={builderWord}
            />

            {isWaiting ? (
              <div className="card p-4 text-center">
                <div className="text-2xl mb-1">⏳</div>
                <div className="text-sm font-semibold">
                  Waiting for {Math.max(0, maxSeats - seatsFilled)} more player{maxSeats - seatsFilled === 1 ? '' : 's'}
                </div>
                <div className="text-[11px] opacity-60 mt-1">
                  {seatsFilled} of {maxSeats} seats filled — the game starts when everyone's in.
                </div>
                {iAmCreator && (
                  <button
                    type="button"
                    onClick={handleCancelInvite}
                    disabled={inviteBusy}
                    className="mt-3 text-xs px-3 py-1.5 rounded-full border border-white/15 opacity-70 hover:opacity-100 disabled:opacity-40"
                  >
                    Cancel game
                  </button>
                )}
              </div>
            ) : isMyTurn ? (
              <>
                <WordBuilder
                  builder={myTurnState.builder ?? []}
                  rollsThisTurn={myTurnState.rolls_used ?? 0}
                  onTapLetter={tapBuilderLetter}
                  onRemoveLetter={removeBuilderLetter}
                  onClear={clearBuilder}
                  swapIdx={swapIdx}
                  builderWord={builderWord}
                  builderScore={builderScore}
                />
                <DiceRack
                  faces={faces}
                  inBuilder={inBuilder}
                  animating={animating}
                  rollsThisTurn={myTurnState.rolls_used ?? 0}
                  onTapDie={tapRackDie}
                  onRoll={handleRoll}
                  disabled={busy}
                />
              </>
            ) : (
              <div className="card p-4 text-center opacity-80">
                <div className="text-sm font-semibold">{currentName} is rolling…</div>
                <div className="text-[11px] opacity-60 mt-1">Tap a player's pill above to see their card</div>
                {/* Claim moved to the always-visible sub-header (c153). */}
              </div>
            )}
          </>
        )}

      </div>

      {oppSheetId && (() => {
        const op = opponents.find(o => o.user_id === oppSheetId)
        if (!op) return null
        return (
          <OpponentScoreSheet
            oppPlayer={op}
            oppProfile={oppProfiles[oppSheetId]}
            totalTurns={TOTAL_TURNS}
            currentTurn={game?.current_turn ?? 1}
            onClose={() => setOppSheetId(null)}
          />
        )
      })()}
    </SQBoardShell>
  )
}

function WaitingCard({
  otherName, iAmCreator, iAmInvitee, iAmPlayer, seatsFilled, maxSeats, hasOpenSeat,
  inviteBusy, onCancel, onJoinOpen, onBack,
}) {
  const display = otherName || 'Someone'

  // Already seated — the game is filling up. Covers the creator and any
  // player who joined a not-yet-full N-player game.
  if (iAmPlayer) {
    const need = Math.max(0, maxSeats - seatsFilled)
    return (
      <div className="card p-5 text-center space-y-3">
        <div className="text-3xl">⏳</div>
        <div>
          <div className="font-display text-xl text-wordy-700">
            Waiting for {need} more player{need === 1 ? '' : 's'}
          </div>
          <p className="text-sm opacity-70 mt-1">
            {seatsFilled} of {maxSeats} seats filled — starts automatically when full.
          </p>
        </div>
        <div className="flex gap-2 justify-center pt-1">
          <button
            type="button"
            onClick={onBack}
            className="text-sm px-3 py-1.5 rounded-lg border border-wordy-200 text-wordy-600 hover:bg-wordy-50"
          >
            ← Lobby
          </button>
          {iAmCreator && (
            <button
              type="button"
              onClick={onCancel}
              disabled={inviteBusy}
              className="text-sm px-3 py-1.5 rounded-lg text-wordy-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:opacity-50"
            >
              Cancel game
            </button>
          )}
        </div>
      </div>
    )
  }

  // Invited but not yet seated — auto-accept runs in the parent effect.
  if (iAmInvitee) {
    return (
      <div className="card p-5 text-center space-y-3">
        <div className="text-3xl">📨</div>
        <div className="font-display text-xl text-wordy-700">
          Accepting invite from {display}…
        </div>
        <p className="text-sm opacity-70">Setting up your game.</p>
      </div>
    )
  }

  // Not invited, but a seat is open — offer to join.
  if (hasOpenSeat) {
    return (
      <div className="card p-5 text-center space-y-3">
        <div className="text-3xl">🎲</div>
        <div>
          <div className="font-display text-xl text-wordy-700">
            {display} has an open game
          </div>
          <p className="text-sm opacity-70 mt-1">
            {seatsFilled} of {maxSeats} seats filled — join to take one.
          </p>
        </div>
        <div className="flex gap-2 justify-center pt-1">
          <button
            type="button"
            onClick={onJoinOpen}
            disabled={inviteBusy}
            className="btn-primary bg-amber-500 hover:bg-amber-600 disabled:opacity-50"
          >
            Join game
          </button>
          <button
            type="button"
            onClick={onBack}
            className="text-sm px-3 py-1.5 rounded-lg border border-wordy-200 text-wordy-600 hover:bg-wordy-50"
          >
            ← Lobby
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="card p-4 text-center text-sm opacity-80">
      This game is full.
    </div>
  )
}

function PlayerPill({ name, score, isCurrent, isWinner, isOut, noShow, onClick }) {
  const base = 'inline-flex items-center gap-1.5 rounded-full px-3 py-0.5 text-xs font-bold transition-all'
  // noShow = invited friend who never joined a short-handed game (c150).
  // Matches the forfeited pill treatment but without the strike-through,
  // a ✗ marker, and no score (they never played).
  const cls = noShow
    ? 'bg-white/5 border border-white/10 text-wordy-400/60'
    : isOut
      ? 'bg-white/5 border border-white/10 text-wordy-400/60 line-through'
      : isWinner
        ? 'bg-yellow-50 border-2 border-yellow-400 text-yellow-800'
        : isCurrent
          ? 'bg-wordy-200 border-2 border-wordy-500 text-wordy-800'
          : 'bg-wordy-50 border border-wordy-200 text-wordy-500'
  const Tag = onClick ? 'button' : 'span'
  return (
    <Tag onClick={onClick} className={`${base} ${cls}`}>
      {noShow && <span className="text-[11px]">✗</span>}
      {!noShow && isOut && <span className="no-underline">🏳️</span>}
      {!noShow && !isOut && isWinner && <span>🏆</span>}
      {!noShow && !isOut && !isWinner && isCurrent && <span>✨</span>}
      <span>{name}</span>
      {!noShow && <span className={`font-display text-sm ${isOut ? '' : 'text-wordy-800'}`}>{score}</span>}
    </Tag>
  )
}
