import { useEffect } from 'react'
import { CATEGORIES } from '../../lib/scoring.js'

// Bottom-sheet popup over MultiGamePage. Shows opponent's full 12-cat
// scorecard + last play. Last-played category is highlighted in pink-400
// (matches SQ tile-selection ring).
export default function OpponentScoreSheet({
  oppPlayer,
  oppProfile,
  totalTurns,
  currentTurn,
  onClose,
}) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const name = oppProfile?.username ?? 'Opponent'
  const initial = name[0]?.toUpperCase() ?? '?'
  const hue = oppProfile?.avatar_hue ?? 270
  const total = oppPlayer?.total_score ?? 0
  const lastWord = oppPlayer?.last_word
  const lastCat = oppPlayer?.last_category
  const lastScore = oppPlayer?.last_score
  const lastCatName = CATEGORIES.find(c => c.id === lastCat)?.name ?? lastCat

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative w-full sm:max-w-md bg-[#181c25] rounded-t-2xl border-t border-x border-white/10 p-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white"
              style={{ background: `hsl(${hue} 50% 50%)` }}
            >{initial}</div>
            <div>
              <div className="font-extrabold text-sm">{name}</div>
              <div className="text-[11px] opacity-60">{total} points · turn {currentTurn}/{totalTurns}</div>
            </div>
          </div>
          <button onClick={onClose} className="text-white/60 hover:text-white text-lg leading-none" aria-label="Close">×</button>
        </div>

        {lastWord && (
          <>
            <div className="text-[10px] uppercase tracking-wide opacity-55 font-bold mb-1">Last play</div>
            <div className="flex gap-1 justify-center mb-1">
              {lastWord.split('').map((ch, i) => (
                <div key={i} className="tile tile-placed font-display text-base w-8 h-8">{ch}</div>
              ))}
            </div>
            <div className="text-[11px] opacity-70 text-center mb-3">"{lastWord}" → {lastCatName} · {lastScore} pts</div>
          </>
        )}
        {!lastWord && lastCat && (
          <div className="text-[11px] opacity-60 text-center mb-3">Took 0 in {lastCatName}.</div>
        )}

        <div className="grid grid-cols-2 gap-1.5">
          {CATEGORIES.map(cat => {
            const filled = oppPlayer?.scores?.[cat.id]
            const filledNum = filled?.score ?? null
            const filledWord = filled?.word ?? null
            const isLast = cat.id === lastCat
            const base = 'rounded-lg px-2 py-1.5 border text-xs'
            let cls
            if (isLast && filled != null) {
              cls = 'border-pink-400 bg-pink-400/15 ring-1 ring-pink-400/40 inset'
            } else if (filled != null) {
              cls = 'border-green-600/40 bg-green-900/20'
            } else {
              cls = 'border-white/10 bg-white/[0.02] opacity-70'
            }
            return (
              <div key={cat.id} className={`${base} ${cls}`}>
                <div className="font-bold">{cat.name}</div>
                {filled != null
                  ? <div className="font-bold text-sm">{filledWord ? `${filledWord} — ${filledNum}` : filledNum}</div>
                  : <div className="opacity-60 text-[11px]">—</div>}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
