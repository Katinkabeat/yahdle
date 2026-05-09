import { useEffect, useState, useCallback, useMemo } from 'react'
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

const TOTAL_TURNS = CATEGORIES.length
import { useRealtimeChannel } from '../../hooks/useRealtimeChannel.js'
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
  forfeitGame,
  claimInactiveWin,
  rematch,
} from '../../lib/multiplayerActions.js'
import OpponentScoreSheet from './OpponentScoreSheet.jsx'
import GameOverComparison from './GameOverComparison.jsx'

export default function MultiGamePage({ session, profile, isAdmin }) {
  const { gameId } = useParams()
  const navigate = useNavigate()
  const userId = session?.user?.id

  const [game, setGame] = useState(null)
  const [players, setPlayers] = useState([])
  const [oppProfile, setOppProfile] = useState(null)
  const [myTurnState, setMyTurnState] = useState({ faces: [], builder: [], rolls_used: 0 })
  const [zeroAskCategory, setZeroAskCategory] = useState(null)
  const [swapIdx, setSwapIdx] = useState(null)
  const [busy, setBusy] = useState(false)
  const [oppSheetOpen, setOppSheetOpen] = useState(false)
  const [animating, setAnimating] = useState([])

  const myPlayer = players.find(p => p.user_id === userId)
  const oppPlayer = players.find(p => p.user_id !== userId)
  const isMyTurn = !!(game && myPlayer && game.status === 'active' && myPlayer.player_index === game.current_player_idx)
  const isGameOver = game?.status === 'finished'
  const inBuilderSet = useMemo(() => {
    const s = new Set()
    for (const b of (myTurnState.builder ?? [])) s.add(b.dieIdx)
    return s
  }, [myTurnState.builder])
  const builderWord = useMemo(() => (myTurnState.builder ?? []).map(b => b.letter).join(''), [myTurnState.builder])
  const builderScore = wordScore(builderWord)

  const refresh = useCallback(async () => {
    if (!gameId) return
    try {
      const [g, ps] = await Promise.all([loadGame(gameId), loadPlayers(gameId)])
      setGame(g)
      setPlayers(ps)
      if (userId) {
        const mts = await loadMyTurnState(gameId, userId)
        setMyTurnState(mts ?? { faces: [], builder: [], rolls_used: 0 })
      }
    } catch (err) {
      console.error('[MultiGamePage refresh]', err)
      toast.error(err.message || 'Failed to load game')
    }
  }, [gameId, userId])

  useEffect(() => { refresh() }, [refresh])

  // Look up opponent profile once we know who they are.
  useEffect(() => {
    if (!oppPlayer?.user_id) return
    supabase.from('profiles').select('id, username, avatar_hue').eq('id', oppPlayer.user_id).single()
      .then(({ data }) => setOppProfile(data ?? null))
  }, [oppPlayer?.user_id])

  useRealtimeChannel({
    channelName: `game-yahdle-${gameId}`,
    subscriptions: gameId ? [
      { event: 'UPDATE', schema: 'public', table: 'yahdle_games', filter: `id=eq.${gameId}` },
      { event: '*', schema: 'public', table: 'yahdle_players', filter: `game_id=eq.${gameId}` },
    ] : [],
    onChange: refresh,
    pollMs: 15_000,
    enabled: !!gameId,
  })

  async function withBusy(fn) {
    if (busy) return
    setBusy(true)
    try { await fn() }
    catch (err) { toast.error(err.message || 'Action failed') }
    finally { setBusy(false); refresh() }
  }

  function handleRoll() {
    if (!isMyTurn || (myTurnState.rolls_used ?? 0) >= ROLLS_PER_TURN) return
    if ((myTurnState.builder?.length ?? 0) >= DIE_COUNT) return
    withBusy(async () => {
      const newFaces = await rollDice(gameId)
      setMyTurnState(s => ({ ...s, faces: newFaces, rolls_used: (s.rolls_used ?? 0) + 1 }))
      setAnimating(new Array(DIE_COUNT).fill(false).map((_, i) => !inBuilderSet.has(i)))
      setTimeout(() => setAnimating(new Array(DIE_COUNT).fill(false)), 500)
    })
  }

  function tapRackDie(i) {
    if (!isMyTurn) return
    if (myTurnState.faces?.[i] == null) return
    if (inBuilderSet.has(i)) return
    if ((myTurnState.builder?.length ?? 0) >= DIE_COUNT) return
    withBusy(() => parkDie(gameId, i))
  }

  function tapBuilderLetter(idx) {
    if (!isMyTurn) return
    if (swapIdx == null) {
      setSwapIdx(idx); return
    }
    if (swapIdx === idx) {
      setSwapIdx(null); return
    }
    const a = swapIdx, b = idx
    setSwapIdx(null)
    withBusy(() => swapLetters(gameId, a, b))
  }

  function removeFromBuilder(idx) {
    if (!isMyTurn) return
    setSwapIdx(null)
    withBusy(() => unparkDie(gameId, idx))
  }

  function tryScore(categoryId) {
    if (!isMyTurn || isGameOver) return
    if (myPlayer?.scores?.[categoryId] != null) return
    const cat = CATEGORIES.find(c => c.id === categoryId)
    if (!cat) return
    if (!builderWord) {
      setZeroAskCategory(categoryId); return
    }
    const fits = cat.validate({ word: builderWord, faces: myTurnState.faces ?? [], score: builderScore })
    if (!fits) {
      setZeroAskCategory(categoryId); return
    }
    withBusy(() => scoreCategory(gameId, categoryId, builderWord))
  }

  function confirmZero(categoryId) {
    setZeroAskCategory(null)
    withBusy(() => takeZero(gameId, categoryId))
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

  async function handleRematch() {
    try {
      const { gameId: newId } = await rematch(gameId)
      toast.success('Rematch invite sent!')
      navigate('/')
    } catch (err) {
      toast.error(err.message || 'Rematch failed')
    }
  }

  // Score totals for pill display.
  const myTotal = myPlayer?.total_score ?? 0
  const oppTotal = oppPlayer?.total_score ?? 0
  const oppName = oppProfile?.username ?? 'Opponent'
  const myName = profile?.username ?? 'You'

  // Inactivity claim — shown when it's NOT my turn and >7 days passed.
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
              {isGameOver ? 'Final' : game ? `Turn ${game.current_turn}/${TOTAL_TURNS}` : ''}
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
      <div className="py-4 px-2 space-y-4">

        {/* score pills */}
        {game && (
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
            {/* My scorecard */}
            <div className="card p-3">
              <h2 className="text-xs uppercase tracking-wide opacity-70 text-center mb-2">Your scorecard</h2>
              <div className="grid grid-cols-2 gap-1.5">
                {CATEGORIES.map(cat => {
                  const filled = myPlayer?.scores?.[cat.id]
                  const filledNum = filled != null ? Number(filled) : null
                  const asking = zeroAskCategory === cat.id
                  if (asking && filled == null) {
                    const reason = builderWord
                      ? `${builderWord} doesn't fit here.`
                      : `No word yet.`
                    return (
                      <div key={cat.id} className="rounded-lg px-2 py-1.5 border border-amber-400/60 bg-amber-900/30 text-xs">
                        <div className="font-bold mb-1">{cat.name}</div>
                        <div className="text-amber-200 mb-1.5 text-[11px]">{reason} Take a 0?</div>
                        <div className="flex gap-1.5">
                          <button onClick={() => confirmZero(cat.id)} className="flex-1 rounded bg-amber-400 text-amber-950 font-bold py-1">Take 0</button>
                          <button onClick={cancelZero} className="flex-1 rounded border border-white/30 text-white py-1">Cancel</button>
                        </div>
                      </div>
                    )
                  }
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => tryScore(cat.id)}
                      disabled={filled != null || !isMyTurn || busy}
                      className={`text-left rounded-lg px-2 py-1.5 border text-xs transition ${
                        filled != null
                          ? 'border-green-600/40 bg-green-900/20 cursor-default'
                          : isMyTurn
                            ? 'border-white/10 hover:border-wordy-500 hover:bg-wordy-700/20'
                            : 'border-white/5 opacity-60 cursor-not-allowed'
                      }`}
                    >
                      <div className="font-bold">{cat.name}</div>
                      {filled != null ? (
                        <div className="text-green-300 font-bold text-sm">{filledNum}</div>
                      ) : (
                        <div className="opacity-60 text-[11px]">{cat.desc}</div>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>

            {isMyTurn ? (
              <>
                {/* Word area */}
                <div className="card p-2">
                  <div className="text-[10px] uppercase tracking-wide opacity-55 font-bold mb-1.5 px-1 flex justify-between">
                    <span>Word</span>
                    {builderWord && <span>{builderWord} · {builderScore} pts</span>}
                  </div>
                  <div className="flex gap-1.5 justify-center flex-wrap">
                    {Array.from({ length: DIE_COUNT }).map((_, i) => {
                      const tile = myTurnState.builder?.[i]
                      if (!tile) {
                        return <div key={i} className="w-9 h-9 rounded-lg border border-dashed border-white/20 flex items-center justify-center text-white/30">·</div>
                      }
                      const isSwap = swapIdx === i
                      return (
                        <div key={i} className="relative">
                          <button
                            type="button"
                            onClick={() => tapBuilderLetter(i)}
                            className={`w-9 h-9 rounded-lg font-extrabold text-lg flex items-center justify-center bg-gradient-to-b from-stone-100 to-stone-300 text-stone-900 ${isSwap ? 'ring-2 ring-amber-400' : ''}`}
                          >
                            {tile.letter}
                          </button>
                          <button
                            type="button"
                            onClick={() => removeFromBuilder(i)}
                            className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-bold leading-none flex items-center justify-center"
                            aria-label="Remove letter"
                          >×</button>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Dice rack */}
                <div className="card p-2">
                  <div className="text-[10px] uppercase tracking-wide opacity-55 font-bold mb-1.5 px-1">
                    Dice (tap to lock into word)
                  </div>
                  <div className="flex gap-1.5 justify-center flex-wrap">
                    {(myTurnState.faces ?? []).map((face, i) => {
                      if (inBuilderSet.has(i) || face == null) return null
                      return (
                        <button
                          key={i}
                          type="button"
                          onClick={() => tapRackDie(i)}
                          className={`w-11 h-11 rounded-xl font-extrabold text-xl flex items-center justify-center bg-gradient-to-b from-stone-100 to-stone-300 text-stone-900 shadow-md ${animating[i] ? 'die-rolling' : ''}`}
                        >
                          {face}
                        </button>
                      )
                    })}
                    {(myTurnState.faces ?? []).every((_, i) => inBuilderSet.has(i)) && (
                      <div className="text-xs opacity-60 py-3">All dice locked into your word.</div>
                    )}
                    {(myTurnState.faces ?? []).length === 0 && (
                      <div className="text-xs opacity-60 py-3">Tap "Roll" to start your turn.</div>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleRoll}
                  disabled={busy || (myTurnState.rolls_used ?? 0) >= ROLLS_PER_TURN}
                  className="w-full btn-primary disabled:opacity-50"
                >
                  {(myTurnState.rolls_used ?? 0) === 0
                    ? 'Roll'
                    : `Re-roll (${ROLLS_PER_TURN - (myTurnState.rolls_used ?? 0)} left)`}
                </button>
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
