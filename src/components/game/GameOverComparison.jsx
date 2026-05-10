import { CATEGORIES } from '../../lib/scoring.js'

// Single-column row layout fitting all 12 categories on mobile.
// Green (you) / pink (opponent) marks who won each row. Used both
// inline at game-end and as the destination from the completed-games
// card on the lobby.
export default function GameOverComparison({
  game,
  myPlayer,
  oppPlayer,
  myName,
  oppName,
  isMyWin,
  isTie,
  onRematch,
}) {
  const myTotal = myPlayer?.total_score ?? 0
  const oppTotal = oppPlayer?.total_score ?? 0

  let banner
  if (game?.closed_by_admin) {
    banner = { emoji: '🛑', text: 'Game closed by admin', sub: game.close_reason ?? '' }
  } else if (game?.forfeit_user_id) {
    const forfeiter = game.forfeit_user_id === myPlayer?.user_id ? myName : oppName
    const winner = game.forfeit_user_id === myPlayer?.user_id ? oppName : myName
    banner = { emoji: '🏳️', text: `${forfeiter} forfeited`, sub: `${winner} wins!` }
  } else if (isTie) {
    banner = { emoji: '🤝', text: "It's a tie!", sub: `${myTotal} — ${oppTotal}` }
  } else if (isMyWin) {
    banner = { emoji: '🏆', text: 'You win!', sub: `${myTotal} — ${oppTotal}` }
  } else {
    banner = { emoji: '🏆', text: `${oppName} wins!`, sub: `${myTotal} — ${oppTotal}` }
  }

  return (
    <>
      <div className="rounded-xl bg-gradient-to-br from-wordy-600 to-wordy-800 p-4 text-center text-white">
        <div className="text-3xl mb-1">{banner.emoji}</div>
        <div className="text-lg font-extrabold">{banner.text}</div>
        {banner.sub && <div className="text-sm opacity-90 mt-0.5">{banner.sub}</div>}
      </div>

      <div className="card p-2">
        <div className="grid grid-cols-[1fr_auto_auto] gap-2 items-center px-2 py-1 text-[10px] uppercase tracking-wider opacity-60 font-bold">
          <div>Category</div>
          <div className="min-w-[34px] text-right">{myName}</div>
          <div className="min-w-[34px] text-right">{oppName}</div>
        </div>
        {CATEGORIES.map((cat, i) => {
          const my = myPlayer?.scores?.[cat.id] ?? null
          const op = oppPlayer?.scores?.[cat.id] ?? null
          const myN = my?.score ?? null
          const opN = op?.score ?? null
          const meWin = myN != null && opN != null && myN > opN
          const themWin = opN != null && myN != null && opN > myN
          const alt = i % 2 === 1
          return (
            <div
              key={cat.id}
              className={`grid grid-cols-[1fr_auto_auto] gap-2 items-center px-2 py-1.5 text-xs rounded-md ${alt ? 'bg-white/[0.02]' : ''}`}
            >
              <div className="font-semibold">{cat.name}</div>
              <div className={`min-w-[34px] text-right font-extrabold ${meWin ? 'text-green-400' : ''}`}>
                {myN ?? '—'}
              </div>
              <div className={`min-w-[34px] text-right font-bold ${themWin ? 'text-pink-300' : 'text-wordy-300'}`}>
                {opN ?? '—'}
              </div>
            </div>
          )
        })}
        <div className="grid grid-cols-[1fr_auto_auto] gap-2 items-center px-2 py-2 mt-1 text-sm border-t border-white/10">
          <div className="font-extrabold">Total</div>
          <div className="min-w-[34px] text-right font-extrabold">{myTotal}</div>
          <div className="min-w-[34px] text-right font-extrabold text-wordy-300">{oppTotal}</div>
        </div>
      </div>

      {!game?.closed_by_admin && (
        <div className="grid grid-cols-2 gap-2">
          <button onClick={onRematch} className="btn-primary">Rematch</button>
        </div>
      )}
    </>
  )
}
