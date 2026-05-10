import { LETTER_VALUES } from '../../lib/scoring.js'

// Shared word area for Solo + Multi.
//
// builder: [{ letter, dieIdx }, …]
// rollsThisTurn: number — drives the empty-state hint text
// onTapLetter(idx), onRemoveLetter(idx), onClear()
// swapIdx: int|null — which builder index is currently selected for swap
export default function WordBuilder({
  builder,
  rollsThisTurn,
  onTapLetter,
  onRemoveLetter,
  onClear,
  swapIdx,
  builderWord,
  builderScore,
}) {
  return (
    <div className="card p-2">
      <div className="flex items-center justify-between mb-1">
        <div className="text-xs uppercase tracking-wide opacity-70">Your word</div>
        {builder.length > 1 && (
          <span className="text-[10px] opacity-50">tap two letters to swap</span>
        )}
      </div>
      <div className="min-h-[44px] flex flex-wrap items-center gap-1.5 mb-1">
        {builder.length === 0 ? (
          <span className="text-sm opacity-50 self-center">
            {rollsThisTurn === 0
              ? 'Roll the dice to start'
              : 'Tap dice below to add letters here'}
          </span>
        ) : (
          builder.map((b, i) => {
            const selected = swapIdx === i
            const value = LETTER_VALUES[b.letter]
            return (
              <div key={i} className="relative">
                <button
                  type="button"
                  onClick={() => onTapLetter(i)}
                  className={`tile tile-placed font-display text-xl w-9 h-9 ${selected ? 'tile-selected' : ''}`}
                >
                  <span className="leading-none">{b.letter}</span>
                  {value != null && <span className="tile-value">{value}</span>}
                </button>
                <button
                  type="button"
                  onClick={() => onRemoveLetter(i)}
                  aria-label="Remove letter"
                  className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-wordy-900 border border-white/30 text-[10px] leading-none flex items-center justify-center hover:bg-red-700"
                >
                  ×
                </button>
              </div>
            )
          })
        )}
      </div>
      <div className="flex justify-between items-center text-xs opacity-70">
        <span>{builderWord ? `${builderWord} • ${builderScore} pts` : ' '}</span>
        {builder.length > 0 && (
          <button onClick={onClear} className="underline">clear</button>
        )}
      </div>
    </div>
  )
}
