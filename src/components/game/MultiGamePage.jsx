import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  SQBoardShell,
  SQLobbyHeader,
  SQBoardHeader,
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
  const [oppProfile, setOppProfile] = useState(null)
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
  const [oppSheetOpen, setOppSheetOpen] = useState(false)
  const [animating, setAnimating] = useState(() => new Array(DIE_COUNT).fill(false))
  const { dict, dictReady } = useDictionary()

  const myPlayer = players.find(p => p.user_id === userId)
  const oppPlayer = players.find(p => p.user_id !== userId)
  const isMyTurn = !!(game && myPlayer && game.status === 'active' && myPlayer.player_index === game.current_player_idx)
  const isGameOver = game?.status === 'finished'
  const isWaiting = game?.status === 'waiting'
  const iAmCreator = !!(game && userId && game.created_by === userId)
  const iAmInvitee = !!(game && userId && game.invited_user_id === userId)
  const isOpenGame = !!(game && game.invited_user_id == null)

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

  useEffect(() => {
    if (!oppPlayer?.user_id) return
    supabase.from('profiles').select('id, username, avatar_hue').eq('id', oppPlayer.user_id).single()
      .then(({ data }) => setOppProfile(data ?? null))
  }, [oppPlayer?.user_id])

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
    if (!gameId || !isWaiting || !iAmInvitee) return
    if (autoAcceptAttempted.current === gameId) return
    autoAcceptAttempted.current = gameId
    setInviteBusy(true)
    acceptInvite(gameId)
      .then(() => refresh())
      .catch(err => toast.error(err.message || 'Failed to accept invite'))
      .finally(() => setInviteBusy(false))
  }, [gameId, isWaiting, iAmInvitee, refresh])

  useRealtimeChannel({
    channelName: `game-yahdle-${gameId}`,
    subscriptions: gameId ? [
      { event: 'UPDATE', schema: 'public', table: 'yahdle_games', filter: `id=eq.${gameId}` },
      { event: '*', schema: 'public', table: 'yahdle_players', filter: `game_id=eq.${gameId}` },
      { event: 'UPDATE', schema: 'public', table: 'yahdle_turn_state', filter: `game_id=eq.${gameId}` },
    ] : [],
    onChange: refresh,
    pollMs: 15_000,
    enabled: !!gameId,
  })

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
    if (!confirm('Forfeit this game?')) return
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

  async function handleRematch() {
    try {
      await rematch(gameId)
      toast.success('Rematch invite sent!')
      navigate('/')
    } catch (err) {
      toast.error(err.message || 'Rematch failed')
    }
  }

  const myTotal = myPlayer?.total_score ?? 0
  const oppTotal = oppPlayer?.total_score ?? 0
  const oppName = oppProfile?.username ?? 'Opponent'
  const myName = profile?.username ?? 'You'

  const canClaim = (() => {
    if (!game || game.status !== 'active' || !myPlayer) return false
    if (myPlayer.player_index === game.current_player_idx) return false
    if (!game.last_activity_at) return false
    const age = Date.now() - new Date(game.last_activity_at).getTime()
    return age > 7 * 24 * 60 * 60 * 1000
  })()

  return (
    <SQBoardShell
      width="narrow"
      header={
        <SQLobbyHeader
          title="Yahdle"
          avatarSlot={<AvatarMenu profile={profile} />}
          rightSlot={<HeaderRight isAdmin={isAdmin} />}
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
          rightSlot={
            !isGameOver && game?.status === 'active' ? (
              <button
                type="button"
                onClick={handleForfeit}
                className="text-xs opacity-70 hover:opacity-100 hover:text-red-300"
                title="Forfeit this game"
              >
                Forfeit
              </button>
            ) : null
          }
        />
      }
    >
      <div className="py-2 px-2 space-y-2">

        {notFound && (
          <div className="card p-4 text-center text-sm opacity-80">
            This game doesn't exist or you're not a participant.
          </div>
        )}

        {/* score pills — only meaningful once both players have joined */}
        {game && !isWaiting && (
          <div className="flex flex-wrap gap-2 justify-center">
            <PlayerPill
              name={`${myName} (you)`}
              score={myTotal}
              isCurrent={isMyTurn && !isGameOver}
              isWinner={isGameOver && myPlayer?.is_winner}
            />
            <PlayerPill
              name={oppName}
              score={oppTotal}
              isCurrent={!isMyTurn && !isGameOver && game.status === 'active'}
              isWinner={isGameOver && oppPlayer?.is_winner}
              onClick={() => setOppSheetOpen(true)}
            />
          </div>
        )}

        {/* Waiting state — invite not yet accepted. Whoever is viewing,
            show an appropriate prompt instead of an empty board. */}
        {isWaiting && (
          <WaitingCard
            otherName={waitingOtherProfile?.username}
            iAmCreator={iAmCreator}
            iAmInvitee={iAmInvitee}
            isOpenGame={isOpenGame}
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
            myPlayer={myPlayer}
            oppPlayer={oppPlayer}
            myName={myName}
            oppName={oppName}
            isMyWin={!!myPlayer?.is_winner && !game.is_tie}
            isTie={game.is_tie}
            onRematch={handleRematch}
          />
        )}

        {/* Active game UI */}
        {!isGameOver && game?.status === 'active' && (
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

            {isMyTurn ? (
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
                <div className="text-sm font-semibold">{oppName} is rolling…</div>
                <div className="text-[11px] opacity-60 mt-1">Tap their pill above to see their card</div>
                {canClaim && (
                  <button
                    type="button"
                    onClick={handleClaim}
                    className="mt-3 text-xs px-3 py-1.5 rounded-full border border-amber-400/60 text-amber-200 hover:bg-amber-400/10"
                  >
                    Claim win (7+ days inactive)
                  </button>
                )}
              </div>
            )}
          </>
        )}

      </div>

      {oppSheetOpen && oppPlayer && (
        <OpponentScoreSheet
          oppPlayer={oppPlayer}
          oppProfile={oppProfile}
          totalTurns={TOTAL_TURNS}
          currentTurn={game?.current_turn ?? 1}
          onClose={() => setOppSheetOpen(false)}
        />
      )}
    </SQBoardShell>
  )
}

function WaitingCard({
  otherName, iAmCreator, iAmInvitee, isOpenGame,
  inviteBusy, onCancel, onJoinOpen, onBack,
}) {
  const display = otherName || 'Someone'

  // Invitee landed via a push notification — auto-accept runs in the
  // parent useEffect. Just show a transient loading state until the
  // game flips to 'active' and the normal UI takes over.
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

  // Creator viewing their own pending invite.
  if (iAmCreator) {
    return (
      <div className="card p-5 text-center space-y-3">
        <div className="text-3xl">⏳</div>
        <div>
          <div className="font-display text-xl text-wordy-700">
            {isOpenGame ? 'Open game — waiting for a joiner' : `Waiting for ${display}`}
          </div>
          <p className="text-sm opacity-70 mt-1">
            {isOpenGame
              ? "Anyone can join from their lobby."
              : "We'll start as soon as they accept."}
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
          <button
            type="button"
            onClick={onCancel}
            disabled={inviteBusy}
            className="text-sm px-3 py-1.5 rounded-lg text-wordy-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:opacity-50"
          >
            Cancel invite
          </button>
        </div>
      </div>
    )
  }

  // Third party landed on an open game URL — offer to join.
  if (isOpenGame) {
    return (
      <div className="card p-5 text-center space-y-3">
        <div className="text-3xl">🎲</div>
        <div>
          <div className="font-display text-xl text-wordy-700">
            {display} has an open game
          </div>
          <p className="text-sm opacity-70 mt-1">
            Join to start a 1v1.
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

  // Fallback — friend invite for someone else. Shouldn't be reachable
  // (RLS blocks SELECT), but render a friendly message in case it does.
  return (
    <div className="card p-4 text-center text-sm opacity-80">
      This invite isn't for you.
    </div>
  )
}

function PlayerPill({ name, score, isCurrent, isWinner, onClick }) {
  const base = 'inline-flex items-center gap-1.5 rounded-full px-3 py-0.5 text-xs font-bold transition-all'
  const cls = isWinner
    ? 'bg-yellow-50 border-2 border-yellow-400 text-yellow-800'
    : isCurrent
      ? 'bg-wordy-200 border-2 border-wordy-500 text-wordy-800'
      : 'bg-wordy-50 border border-wordy-200 text-wordy-500'
  const Tag = onClick ? 'button' : 'span'
  return (
    <Tag onClick={onClick} className={`${base} ${cls}`}>
      {isWinner && <span>🏆</span>}
      {!isWinner && isCurrent && <span>✨</span>}
      <span>{name}</span>
      <span className="font-display text-sm text-wordy-800">{score}</span>
    </Tag>
  )
}
