import { CATEGORIES } from '../../lib/scoring.js'

// Final-score comparison grid for 2–4 players. One column per player
// (in seat order, you first), the per-row leader marked green, a totals
// row, and an outcome banner. Top-score group all win (a tie-for-first
// shows every tied player as a winner). Reached inline at game-end and
// from the completed-games card on the lobby.
export default function GameOverComparison({
  game, players, profiles, myUserId,
  onRematch, onRequestRematch, onAcceptRematch, onDeclineRematch, rematchBusy,
}) {
  const ordered = [...(players ?? [])].sort((a, b) => a.player_index - b.player_index)
  const nameFor = (p) =>
    p.user_id === myUserId ? 'You' : (profiles?.[p.user_id]?.username ?? 'Player')

  const totalFor = (p) => p?.total_score ?? 0
  const maxTotal = ordered.length ? Math.max(...ordered.map(totalFor)) : 0
  const winners = ordered.filter(p => p.is_winner)
  const iWon = winners.some(p => p.user_id === myUserId)
  const winnerNames = winners.map(nameFor)

  let banner
  if (game?.closed_by_admin) {
    banner = { emoji: '🛑', text: 'Game closed by admin', sub: game.close_reason ?? '' }
  } else if (game?.forfeit_user_id) {
    const quitter = ordered.find(p => p.user_id === game.forfeit_user_id)
    banner = {
      emoji: '🏳️',
      text: `${quitter ? nameFor(quitter) : 'A player'} forfeited`,
      sub: winners.length ? `${winnerNames.join(' & ')} win${winners.length > 1 ? '' : 's'}!` : '',
    }
  } else if (iWon) {
    const others = winners.filter(p => p.user_id !== myUserId).map(nameFor)
    banner = { emoji: '🏆', text: 'You win!', sub: others.length ? `Tied for 1st with ${others.join(', ')}` : `${maxTotal} pts` }
  } else {
    banner = { emoji: '🏆', text: `${winnerNames.join(' & ')} win${winners.length > 1 ? '' : 's'}!`, sub: `${maxTotal} pts` }
  }

  const gridStyle = { gridTemplateColumns: `1fr repeat(${ordered.length}, minmax(34px, auto))` }

  return (
    <>
      <div className="rounded-xl bg-gradient-to-br from-wordy-600 to-wordy-800 p-4 text-center text-white">
        <div className="text-3xl mb-1">{banner.emoji}</div>
        <div className="text-lg font-extrabold">{banner.text}</div>
        {banner.sub && <div className="text-sm opacity-90 mt-0.5">{banner.sub}</div>}
      </div>

      <div className="card p-2 overflow-x-auto">
        <div className="grid gap-2 items-end px-2 py-1 text-[10px] uppercase tracking-wider opacity-60 font-bold" style={gridStyle}>
          <div>Category</div>
          {ordered.map(p => (
            <div key={p.user_id} className="min-w-[34px] text-right truncate max-w-[64px] justify-self-end">
              {nameFor(p)}
            </div>
          ))}
        </div>

        {CATEGORIES.map((cat, i) => {
          const vals = ordered.map(p => p.scores?.[cat.id]?.score ?? null)
          const rowMax = Math.max(...vals.map(v => v ?? -1))
          const alt = i % 2 === 1
          return (
            <div
              key={cat.id}
              className={`grid gap-2 items-center px-2 py-1.5 text-xs rounded-md ${alt ? 'bg-white/[0.02]' : ''}`}
              style={gridStyle}
            >
              <div className="font-semibold">{cat.name}</div>
              {vals.map((v, idx) => {
                const lead = v != null && v === rowMax && rowMax >= 0
                return (
                  <div
                    key={ordered[idx].user_id}
                    className={`min-w-[34px] text-right font-bold ${lead ? 'text-green-400' : 'text-wordy-300'}`}
                  >
                    {v ?? '—'}
                  </div>
                )
              })}
            </div>
          )
        })}

        <div className="grid gap-2 items-center px-2 py-2 mt-1 text-sm border-t border-white/10" style={gridStyle}>
          <div className="font-extrabold">Total</div>
          {ordered.map(p => (
            <div
              key={p.user_id}
              className={`min-w-[34px] text-right font-extrabold ${totalFor(p) === maxTotal ? 'text-green-400' : ''}`}
            >
              {totalFor(p)}
            </div>
          ))}
        </div>
      </div>

      {!game?.closed_by_admin && (
        <RematchControls
          game={game}
          myUserId={myUserId}
          onRematch={onRematch}
          onRequestRematch={onRequestRematch}
          onAcceptRematch={onAcceptRematch}
          onDeclineRematch={onDeclineRematch}
          busy={rematchBusy}
        />
      )}
    </>
  )
}

// Single-rematch handshake controls (c165). 1v1 games get the
// one-open-request flow; N-player games (not creatable in the current
// lobby) keep the legacy unilateral re-invite button.
function RematchControls({ game, myUserId, onRematch, onRequestRematch, onAcceptRematch, onDeclineRematch, busy }) {
  const isDuel = (game?.max_players ?? 2) === 2
  if (!isDuel) {
    return (
      <div className="grid grid-cols-1 gap-2">
        <button onClick={onRematch} className="btn-primary">Rematch</button>
      </div>
    )
  }

  const reqBy = game?.rematch_requested_by ?? null

  // I claimed the rematch — waiting on my opponent to accept.
  if (reqBy && reqBy === myUserId) {
    return (
      <div className="card p-3 text-center space-y-2">
        <div className="text-sm font-semibold">Rematch requested ⏳</div>
        <div className="text-[11px] opacity-60">Waiting for your opponent to accept.</div>
        <button
          onClick={onDeclineRematch}
          disabled={busy}
          className="text-xs px-3 py-1.5 rounded-full border border-white/15 opacity-70 hover:opacity-100 disabled:opacity-40"
        >
          Cancel request
        </button>
      </div>
    )
  }

  // My opponent claimed it — accept or decline.
  if (reqBy && reqBy !== myUserId) {
    return (
      <div className="card p-3 text-center space-y-2">
        <div className="text-sm font-semibold">Your opponent wants a rematch! 🎲</div>
        <div className="grid grid-cols-2 gap-2 pt-1">
          <button onClick={onAcceptRematch} disabled={busy} className="btn-primary disabled:opacity-50">Accept</button>
          <button
            onClick={onDeclineRematch}
            disabled={busy}
            className="px-3 py-2 rounded-lg border border-wordy-200 text-wordy-600 hover:bg-wordy-50 disabled:opacity-50"
          >
            Decline
          </button>
        </div>
      </div>
    )
  }

  // No open request yet.
  return (
    <div className="grid grid-cols-1 gap-2">
      <button onClick={onRequestRematch} disabled={busy} className="btn-primary disabled:opacity-50">Rematch</button>
    </div>
  )
}
