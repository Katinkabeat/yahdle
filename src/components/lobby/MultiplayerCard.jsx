import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { acceptInvite, declineInvite, cancelInvite } from '../../lib/multiplayerActions.js'
import CreateGameSheet from './CreateGameSheet.jsx'

// Yahdle MP lobby card. Pending invites first, your-turn second, waiting third.
// Lobby data is fetched once in LobbyPage via useMultiplayerLobby and passed in.
export default function MultiplayerCard({
  user,
  pendingInvites = [],
  sentInvites = [],
  activeGames = [],
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
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-display text-xl">🎮 Multiplayer</h2>
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className="text-xs px-3 py-1.5 rounded-full border border-white/20 hover:border-white/40 font-semibold"
          >
            + New game
          </button>
        </div>

        {loading && <p className="text-sm opacity-60 text-center py-2">Loading…</p>}

        {!loading && pendingInvites.length === 0 && sentInvites.length === 0 && yourTurn.length === 0 && waiting.length === 0 && (
          <p className="text-sm opacity-60 text-center py-3">
            No active games — invite a friend to start one.
          </p>
        )}

        <div className="space-y-2">
          {sentInvites.map(g => {
            const opp = opponents[g.invited_user_id]
            return (
              <div
                key={g.id}
                className="rounded-xl border border-white/10 bg-white/[0.03] p-3 flex items-center justify-between"
              >
                <div>
                  <div className="text-[11px] uppercase tracking-wide font-bold opacity-60">Invite sent</div>
                  <div className="text-sm font-semibold">Waiting for {opp?.username ?? 'opponent'} to accept</div>
                </div>
                <button
                  onClick={() => handleCancel(g.id)}
                  className="text-xs px-3 py-1.5 rounded-full border border-white/20 hover:border-red-400/60 hover:text-red-300 text-white/70"
                >
                  Cancel
                </button>
              </div>
            )
          })}

          {pendingInvites.map(g => {
            const opp = opponentOf(g)
            return (
              <div
                key={g.id}
                className="rounded-xl border border-emerald-400/40 bg-emerald-400/10 p-3 flex items-center justify-between"
              >
                <div>
                  <div className="text-[11px] uppercase tracking-wide font-bold text-emerald-300">Invite</div>
                  <div className="text-sm font-semibold">{opp?.username ?? 'Someone'} invited you</div>
                </div>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => handleAccept(g.id)}
                    className="text-xs px-3 py-1.5 rounded-full bg-emerald-400 text-emerald-950 font-bold"
                  >
                    Accept
                  </button>
                  <button
                    onClick={() => handleDecline(g.id)}
                    className="text-xs px-2 py-1.5 rounded-full border border-white/20 hover:border-white/40 text-white/80"
                    aria-label="Decline"
                  >
                    ×
                  </button>
                </div>
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
                className="w-full text-left rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 flex items-center justify-between hover:border-amber-400/70"
              >
                <div>
                  <div className="text-[11px] uppercase tracking-wide font-bold text-amber-300">Your turn</div>
                  <div className="text-sm font-semibold">vs {opp?.username ?? 'opponent'} · turn {g.current_turn}/12</div>
                  <div className="text-[11px] opacity-70">
                    You {myPlayer?.total_score ?? 0} — {opp?.username?.split(' ')[0] ?? 'them'} {oppPlayer?.total_score ?? 0}
                  </div>
                </div>
                <span className="text-amber-300 text-xl">→</span>
              </button>
            )
          })}

          {waiting.map(g => {
            const opp = opponentOf(g)
            const myPlayer = g.yahdle_players.find(p => p.user_id === user?.id)
            const oppPlayer = g.yahdle_players.find(p => p.user_id !== user?.id)
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => navigate(`/multi/${g.id}`)}
                className="w-full text-left rounded-xl border border-white/10 bg-white/[0.03] p-3 flex items-center justify-between hover:border-white/20"
              >
                <div>
                  <div className="text-[11px] uppercase tracking-wide font-bold opacity-60">
                    Waiting on {opp?.username ?? 'opponent'}
                  </div>
                  <div className="text-sm font-semibold">vs {opp?.username ?? 'opponent'} · turn {g.current_turn}/12</div>
                  <div className="text-[11px] opacity-70">
                    You {myPlayer?.total_score ?? 0} — {opp?.username?.split(' ')[0] ?? 'them'} {oppPlayer?.total_score ?? 0}
                  </div>
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
