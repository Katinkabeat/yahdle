import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { acceptInvite, declineInvite, cancelInvite, joinOpenGame } from '../../lib/multiplayerActions.js'
import CreateGameSheet from './CreateGameSheet.jsx'

// Yahdle MP lobby card. Pending invites first, your-turn second, waiting
// third, joinable open games last. Lobby data is fetched once in
// LobbyPage via useMultiplayerLobby and passed in.
export default function MultiplayerCard({
  user,
  pendingInvites = [],
  sentInvites = [],
  activeGames = [],
  openGames = [],
  opponents = {},
  loading = false,
}) {
  const navigate = useNavigate()
  const [sheetOpen, setSheetOpen] = useState(false)

  function opponentOf(game) {
    const oppId = game.created_by === user?.id ? game.invited_user_id : game.created_by
    return opponents[oppId]
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

  async function handleJoinOpen(gameId) {
    try {
      await joinOpenGame(gameId)
      toast.success('Game on!')
      navigate(`/multi/${gameId}`)
    } catch (err) {
      toast.error(err.message || 'Failed to join')
    }
  }

  // Split active games into your-turn / waiting-on-opponent.
  const yourTurn = []
  const waiting = []
  for (const g of activeGames) {
    const myPlayer = g.yahdle_players?.find(p => p.user_id === user?.id)
    if (!myPlayer) continue
    if (myPlayer.player_index === g.current_player_idx) yourTurn.push(g)
    else waiting.push(g)
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

        {(pendingInvites.length === 0 && sentInvites.length === 0 && yourTurn.length === 0 && waiting.length === 0 && openGames.length === 0 && !loading) && (
          <p className="text-sm text-wordy-400 text-center py-2">
            No active games — start an open game or invite a friend.
          </p>
        )}

        <div className="space-y-2">
          {pendingInvites.map(g => {
            const opp = opponentOf(g)
            return (
              <div
                key={g.id}
                className="flex items-center justify-between rounded-xl px-3 py-2 border bg-wordy-50 border-wordy-100 dark:bg-[#1a1130] dark:border-[#2d1b55]"
              >
                <div className="min-w-0">
                  <div className="text-sm font-semibold truncate">{opp?.username ?? 'Someone'}</div>
                  <p className="text-xs text-wordy-400 mt-0.5">📨 invited you to a game</p>
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
            const isOpen = !g.invited_user_id
            const opp = isOpen ? null : opponents[g.invited_user_id]
            const title = isOpen ? '🎲 Your open game' : (opp?.username ?? 'Opponent')
            const subtitle = isOpen
              ? '⏳ Waiting for someone to join'
              : '⏳ Waiting for them to accept'
            return (
              <div
                key={g.id}
                className="flex items-center justify-between rounded-xl px-3 py-2 border bg-wordy-50 border-wordy-100 dark:bg-[#1a1130] dark:border-[#2d1b55]"
              >
                <div className="min-w-0">
                  <div className="text-sm font-semibold truncate">{title}</div>
                  <p className="text-xs text-wordy-400 mt-0.5">{subtitle}</p>
                </div>
                <button
                  onClick={() => handleCancel(g.id)}
                  className="w-7 h-7 grid place-items-center rounded-full text-wordy-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 shrink-0"
                  aria-label={isOpen ? 'Cancel open game' : 'Cancel invite'}
                >
                  ×
                </button>
              </div>
            )
          })}

          {yourTurn.map(g => {
            const opp = opponentOf(g)
            const myPlayer = g.yahdle_players.find(p => p.user_id === user?.id)
            const oppPlayer = g.yahdle_players.find(p => p.user_id !== user?.id)
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => navigate(`/multi/${g.id}`)}
                className="w-full text-left flex items-center justify-between rounded-xl px-3 py-2 border bg-wordy-50 border-wordy-100 dark:bg-[#1a1130] dark:border-[#2d1b55] hover:border-wordy-300 dark:hover:border-[#4a2d80]"
              >
                <div className="min-w-0">
                  <div className="text-sm font-semibold truncate">vs {opp?.username ?? 'opponent'}</div>
                  <p className="text-xs text-wordy-400 mt-0.5">
                    🎯 Your turn · {myPlayer?.total_score ?? 0} – {oppPlayer?.total_score ?? 0} · turn {g.current_turn}/12
                  </p>
                </div>
                <span className="text-xs px-3 py-1.5 rounded-lg font-bold btn-primary bg-amber-500 hover:bg-amber-600 shrink-0">
                  Play
                </span>
              </button>
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
                  <p className="text-xs text-wordy-400 mt-0.5">🎲 Open game · waiting</p>
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

          {waiting.map(g => {
            const opp = opponentOf(g)
            const myPlayer = g.yahdle_players.find(p => p.user_id === user?.id)
            const oppPlayer = g.yahdle_players.find(p => p.user_id !== user?.id)
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => navigate(`/multi/${g.id}`)}
                className="w-full text-left flex items-center justify-between rounded-xl px-3 py-2 border bg-wordy-50 border-wordy-100 dark:bg-[#1a1130] dark:border-[#2d1b55] hover:border-wordy-300 dark:hover:border-[#4a2d80]"
              >
                <div className="min-w-0">
                  <div className="text-sm font-semibold truncate">vs {opp?.username ?? 'opponent'}</div>
                  <p className="text-xs text-wordy-400 mt-0.5">
                    ⏳ Waiting on them · {myPlayer?.total_score ?? 0} – {oppPlayer?.total_score ?? 0} · turn {g.current_turn}/12
                  </p>
                </div>
                <span className="opacity-40 text-xl">→</span>
              </button>
            )
          })}
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
