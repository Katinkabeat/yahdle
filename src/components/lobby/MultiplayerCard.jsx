import { Fragment, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { acceptInvite, declineInvite, cancelInvite, joinOpenGame, sendNudge, isNudgeEnabled, declineRematch } from '../../lib/multiplayerActions.js'
import CreateGameSheet from './CreateGameSheet.jsx'
import { timeAgo } from '../../../../rae-side-quest/packages/sq-ui'

const NUDGE_COOLDOWN_MS = 12 * 60 * 60 * 1000 // 12 hours

// Yahdle MP lobby card. Pending invites first, sent invites second, active
// games (Wordy-style player chips) third, joinable open games last. Lobby
// data is fetched once in LobbyPage via useMultiplayerLobby and passed in.
export default function MultiplayerCard({
  user,
  profile,
  pendingInvites = [],
  sentInvites = [],
  pendingRematches = [],
  activeGames = [],
  openGames = [],
  opponents = {},
  loading = false,
}) {
  const navigate = useNavigate()
  const [sheetOpen, setSheetOpen] = useState(false)
  const [nudgingId, setNudgingId] = useState(null)
  const [nudgedIds, setNudgedIds] = useState(() => new Set())
  // current-player user_id -> whether they have nudge notifications on.
  const [nudgePrefs, setNudgePrefs] = useState(() => new Map())

  const nameFor = (id) => opponents[id]?.username ?? 'Someone'
  // My own name isn't in the opponents map — resolve it from profile.
  const displayName = (id) => (id === user?.id ? (profile?.username ?? 'You') : nameFor(id))

  const currentPlayerId = (g) =>
    g.yahdle_players?.find(p => p.player_index === g.current_player_idx)?.user_id

  // Everything that qualifies a game for a nudge EXCEPT the opponent's opt-in:
  // active game, not my turn, current turn idle > 12h, no nudge in the last 12h
  // (or already nudged this session).
  function nudgeEligible(g) {
    const me = g.yahdle_players?.find(p => p.user_id === user?.id)
    if (!me || g.status !== 'active') return false
    if (me.player_index === g.current_player_idx) return false
    const now = Date.now()
    const turnAge  = g.last_activity_at ? now - new Date(g.last_activity_at).getTime() : 0
    const nudgeAge = g.last_nudged_at   ? now - new Date(g.last_nudged_at).getTime()   : Infinity
    return turnAge > NUDGE_COOLDOWN_MS && nudgeAge > NUDGE_COOLDOWN_MS && !nudgedIds.has(g.id)
  }

  // Show the bell only if the opponent can actually receive it. Bell stays
  // hidden until their pref loads; reappears if they turn nudges back on
  // (prefs are re-fetched whenever the games list refreshes).
  function canNudge(g) {
    if (!nudgeEligible(g)) return false
    return nudgePrefs.get(currentPlayerId(g)) === true
  }

  // Fetch the nudge opt-in for the current player of every otherwise-eligible
  // game, so we know whether to show the bell. Re-runs when the games list
  // changes; a fresh Map each pass keeps it correct in both directions.
  useEffect(() => {
    const ids = [...new Set(
      activeGames.filter(nudgeEligible).map(currentPlayerId).filter(Boolean)
    )]
    if (ids.length === 0) { setNudgePrefs(new Map()); return }
    let cancelled = false
    Promise.all(ids.map(async (id) => [id, await isNudgeEnabled(id)]))
      .then((entries) => { if (!cancelled) setNudgePrefs(new Map(entries)) })
      .catch(() => {})
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGames, user?.id])

  async function handleNudge(e, g) {
    e.stopPropagation()
    if (nudgingId) return
    setNudgingId(g.id)
    try {
      await sendNudge(g.id, profile?.username)
      setNudgedIds(prev => new Set(prev).add(g.id))
      toast.success('🔔 Reminder sent!')
    } catch (err) {
      toast.error(err.message || 'Failed to send reminder')
    } finally {
      setNudgingId(null)
    }
  }
  function inviteeNames(game) {
    const ids = (game.invited_user_ids ?? [])
    const list = ids.length ? ids : (game.invited_user_id ? [game.invited_user_id] : [])
    return list.map(nameFor)
  }

  async function handleAccept(gameId) {
    try {
      await acceptInvite(gameId)
      toast.success('Game on!')
      navigate(`/multi/${gameId}`)
    } catch (err) {
      toast.error(err.message || 'Failed to accept')
    }
  }

  async function handleDecline(gameId) {
    if (!confirm('Decline this invite?')) return
    try {
      await declineInvite(gameId)
    } catch (err) {
      toast.error(err.message || 'Failed to decline')
    }
  }

  async function handleCancel(gameId) {
    if (!confirm('Cancel this invite?')) return
    try {
      await cancelInvite(gameId)
    } catch (err) {
      toast.error(err.message || 'Failed to cancel')
    }
  }

  async function handleCancelRematch(gameId) {
    if (!confirm('Cancel this rematch request?')) return
    try {
      await declineRematch(gameId)
    } catch (err) {
      toast.error(err.message || 'Failed to cancel')
    }
  }

  // The opponent in a finished 1v1 game (for the "waiting on them" label).
  const opponentName = (g) => {
    const opp = (g.yahdle_players ?? []).find(p => p.user_id !== user?.id)
    return opp ? nameFor(opp.user_id) : 'your opponent'
  }

  async function handleJoinOpen(gameId) {
    try {
      await joinOpenGame(gameId)
      toast.success('Game on!')
      navigate(`/multi/${gameId}`)
    } catch (err) {
      toast.error(err.message || 'Failed to join')
    }
  }

  return (
    <>
      <section className="card">
        <h2 className="font-display text-xl text-wordy-700 mb-1">🎮 Multiplayer</h2>
        <p className="text-sm opacity-80 mb-3">
          Invite a friend, race to the highest 12-category total.
        </p>
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          className="btn-primary mb-4"
        >
          ✨ Create Game
        </button>

        {loading && <p className="text-sm opacity-60 text-center py-2">Loading…</p>}

        {(pendingInvites.length === 0 && sentInvites.length === 0 && pendingRematches.length === 0 && activeGames.length === 0 && openGames.length === 0 && !loading) && (
          <p className="text-sm text-wordy-400 text-center py-2">
            No active games — start an open game or invite a friend.
          </p>
        )}

        <div className="space-y-2">
          {pendingInvites.map(g => {
            const max = g.max_players ?? 2
            return (
              <div
                key={g.id}
                className="flex items-center justify-between rounded-xl px-3 py-2 border bg-wordy-50 border-wordy-100 dark:bg-[#1a1130] dark:border-[#2d1b55]"
              >
                <div className="min-w-0">
                  <div className="text-sm font-semibold truncate">{nameFor(g.created_by)}</div>
                  <p className="text-xs text-wordy-400 mt-0.5">📨 invited you{max > 2 ? ` to a ${max}-player game` : ' to a game'}</p>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <button
                    onClick={() => handleAccept(g.id)}
                    className="text-xs px-3 py-1.5 rounded-lg font-bold btn-primary bg-amber-500 hover:bg-amber-600"
                  >
                    Accept
                  </button>
                  <button
                    onClick={() => handleDecline(g.id)}
                    className="w-7 h-7 grid place-items-center rounded-full text-wordy-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                    aria-label="Decline"
                  >
                    ×
                  </button>
                </div>
              </div>
            )
          })}

          {sentInvites.map(g => {
            const iAmCreator = g.created_by === user?.id
            const names = inviteeNames(g)
            const isOpen = names.length === 0
            const joined = (g.yahdle_players ?? []).length
            const max = g.max_players ?? 2
            const title = !iAmCreator
              ? `${nameFor(g.created_by)}'s game`
              : (isOpen ? '🎲 Your open game' : `Invited: ${names.join(', ')}`)
            const subtitle = isOpen
              ? `⏳ ${joined}/${max} in · waiting for players`
              : `⏳ ${joined}/${max} seats filled · waiting`
            return (
              <div
                key={g.id}
                role="button"
                tabIndex={0}
                onClick={() => navigate(`/multi/${g.id}`)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/multi/${g.id}`) } }}
                className="cursor-pointer flex items-center justify-between rounded-xl px-3 py-2 border bg-wordy-50 border-wordy-100 dark:bg-[#1a1130] dark:border-[#2d1b55] hover:border-wordy-300 dark:hover:border-[#4a2d80]"
              >
                <div className="min-w-0">
                  <div className="text-sm font-semibold truncate">{title}</div>
                  <p className="text-xs text-wordy-400 mt-0.5">{subtitle}</p>
                </div>
                {iAmCreator ? (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleCancel(g.id) }}
                    className="w-7 h-7 grid place-items-center rounded-full text-wordy-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 shrink-0"
                    aria-label={isOpen ? 'Cancel open game' : 'Cancel invite'}
                  >
                    ×
                  </button>
                ) : (
                  <span className="opacity-40 text-xl shrink-0" aria-hidden="true">→</span>
                )}
              </div>
            )
          })}

          {pendingRematches.map(g => (
            <div
              key={g.id}
              className="flex items-center justify-between rounded-xl px-3 py-2 border bg-wordy-50 border-wordy-100 dark:bg-[#1a1130] dark:border-[#2d1b55]"
            >
              <div className="min-w-0">
                <div className="text-sm font-semibold truncate">🔁 Rematch sent</div>
                <p className="text-xs text-wordy-400 mt-0.5">⏳ waiting for {opponentName(g)}</p>
              </div>
              <button
                onClick={() => handleCancelRematch(g.id)}
                className="w-7 h-7 grid place-items-center rounded-full text-wordy-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 shrink-0"
                aria-label="Cancel rematch"
              >
                ×
              </button>
            </div>
          ))}

          {activeGames.map(g => {
            const players = (g.yahdle_players ?? []).slice().sort((a, b) => a.player_index - b.player_index)
            const max = g.max_players ?? players.length
            const nudgeable = canNudge(g)
            return (
              <div
                key={g.id}
                className="flex items-center justify-between rounded-xl px-3 py-2 border bg-wordy-50 border-wordy-100 dark:bg-[#1a1130] dark:border-[#2d1b55]"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {players.map((p, i) => {
                      const isCurrentTurn = p.player_index === g.current_player_idx
                      const showNudge = isCurrentTurn && nudgeable
                      // 4-player games: break after chip 2 so chips wrap 2-per-row.
                      const breakAfter = players.length === 4 && i === 1
                      return (
                        <Fragment key={p.user_id}>
                          <span
                            className={`text-xs font-bold px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${
                              isCurrentTurn
                                ? 'text-white bg-wordy-500'
                                : 'text-wordy-700 bg-wordy-200'
                            }`}
                          >
                            {showNudge && (
                              <button
                                onClick={(e) => handleNudge(e, g)}
                                disabled={nudgingId === g.id}
                                className="hover:scale-110 transition-transform leading-none"
                                title="Send a reminder"
                              >
                                {nudgingId === g.id ? '⏳' : '🔔'}
                              </button>
                            )}
                            {displayName(p.user_id)}
                          </span>
                          {breakAfter && <div className="basis-full h-0" aria-hidden="true" />}
                        </Fragment>
                      )
                    })}
                    <span className="text-xs text-wordy-400">
                      ({players.length}/{max})
                    </span>
                  </div>
                  <p className="text-xs text-wordy-400 mt-0.5">{timeAgo(g.last_activity_at) || '🟢 In progress'}</p>
                </div>
                <button
                  onClick={() => navigate(`/multi/${g.id}`)}
                  className="text-xs px-3 py-1.5 rounded-lg font-bold btn-primary shrink-0 min-w-[5rem]"
                >
                  ▶ Resume
                </button>
              </div>
            )
          })}

          {openGames.map(g => (
            <div
              key={g.id}
              className="flex items-center justify-between rounded-xl px-3 py-2 border bg-wordy-50 border-wordy-100 dark:bg-[#1a1130] dark:border-[#2d1b55]"
            >
              <div className="min-w-0 flex items-center gap-2">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                  style={{ background: `hsl(${g.creator_avatar_hue ?? 270} 50% 50%)` }}
                >
                  {g.creator_username?.[0]?.toUpperCase() ?? '?'}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold truncate">
                    {g.creator_username ?? 'Someone'}
                  </div>
                  <p className="text-xs text-wordy-400 mt-0.5">🎲 Open game · {g.players_joined ?? 1}/{g.max_players ?? 2} joined</p>
                </div>
              </div>
              <button
                onClick={() => handleJoinOpen(g.id)}
                className="text-xs px-3 py-1.5 rounded-lg font-bold btn-primary bg-amber-500 hover:bg-amber-600 shrink-0"
              >
                Join
              </button>
            </div>
          ))}

        </div>
      </section>

      {sheetOpen && (
        <CreateGameSheet
          user={user}
          onClose={() => setSheetOpen(false)}
          onCreated={() => setSheetOpen(false)}
        />
      )}
    </>
  )
}
