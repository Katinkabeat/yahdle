import { CATEGORIES } from '../../lib/scoring.js'

// Shared 12-category scorecard for Solo + Multi.
//
// scores: { categoryId: { word, score } | undefined }
// onTryScore(categoryId): tap a category cell to try scoring (or pivot
//   into "Take a 0?" via the parent's zeroAskCategory state).
// disabled: true when the cell shouldn't be clickable (game over, not
//   your turn, etc).
export default function Scorecard({
  scores,
  onTryScore,
  disabled = false,
  zeroAskCategory,
  onConfirmZero,
  onCancelZero,
  builderWord,
}) {
  return (
    <div className="card p-2">
      <h2 className="text-xs uppercase tracking-wide opacity-70 text-center mb-1">Scorecard</h2>
      <div className="grid grid-cols-2 gap-1">
        {CATEGORIES.map(cat => {
          const filled = scores?.[cat.id]
          const asking = zeroAskCategory === cat.id

          if (asking && !filled) {
            const reason = builderWord
              ? `${builderWord} doesn't fit here.`
              : `No word yet.`
            return (
              <div
                key={cat.id}
                className="rounded-lg px-2 py-1.5 border border-amber-400/60 bg-amber-900/30 text-xs"
              >
                <div className="font-bold mb-1">{cat.name}</div>
                <div className="text-amber-200 mb-1.5 text-[11px]">
                  {reason} Take a 0?
                </div>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => onConfirmZero(cat.id)}
                    className="flex-1 rounded bg-amber-400 text-amber-950 font-bold py-1"
                  >
                    Take 0
                  </button>
                  <button
                    type="button"
                    onClick={onCancelZero}
                    className="flex-1 rounded border border-white/30 text-white py-1"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )
          }

          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => onTryScore(cat.id)}
              disabled={!!filled || disabled}
              className={`text-left rounded-lg px-2 py-1 border text-xs transition ${
                filled
                  ? 'border-green-600/40 bg-green-900/20 cursor-default'
                  : disabled
                    ? 'border-white/5 opacity-60 cursor-not-allowed'
                    : 'border-white/10 hover:border-wordy-500 hover:bg-wordy-700/20'
              }`}
            >
              <div className="font-bold">{cat.name}</div>
              {filled ? (
                <div className="text-green-400 text-[10px]">
                  {filled.word ? `${filled.word} — ${filled.score} pts` : `— ${filled.score} pts`}
                </div>
              ) : (
                <div className="opacity-60 text-[10px]">{cat.desc}</div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
