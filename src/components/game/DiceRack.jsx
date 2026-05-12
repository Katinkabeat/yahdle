import { SQButton } from '../../../../rae-side-quest/packages/sq-ui'
import { DIE_COUNT, ROLLS_PER_TURN } from '../../lib/dice.js'
import { LETTER_VALUES } from '../../lib/scoring.js'

// Shared dice rack + Roll control for Solo + Multi.
//
// faces: text[] of length DIE_COUNT (entries may be null before first roll
//   or for empty slots). Parked dice still occupy their slot — we render
//   them as faded "·" placeholders so the rack stays a stable 6-wide layout.
// inBuilder: boolean[] of length DIE_COUNT — true if that die is in the
//   word builder (i.e. parked).
// animating: boolean[] of length DIE_COUNT — true while a die is mid-roll.
// rollsThisTurn: 0/1/2/3
// onTapDie(i): tap a rack die to move it to the word area
// onRoll(): tap the Roll button
// disabled: external disable (e.g. waiting on opponent in MP)
export default function DiceRack({
  faces,
  inBuilder,
  animating,
  rollsThisTurn,
  onTapDie,
  onRoll,
  disabled = false,
}) {
  const allParked = inBuilder.every(Boolean)
  const rollDisabled = disabled || rollsThisTurn >= ROLLS_PER_TURN || allParked

  return (
    <div className="card p-2">
      <div className="text-xs uppercase tracking-wide opacity-70 mb-1 text-center">
        {rollsThisTurn === 0
          ? 'Roll the dice'
          : 'Tap a die to move it into your word'}
      </div>
      <div className="flex justify-center gap-1.5 mb-2">
        {(faces ?? []).map((face, i) => {
          const empty = face == null
          const parked = inBuilder[i]
          const isRolling = animating?.[i]
          const value = face ? LETTER_VALUES[face] : null
          return (
            <button
              key={i}
              type="button"
              onClick={() => empty || parked ? null : onTapDie(i)}
              disabled={empty || parked || disabled}
              style={{ perspective: '400px' }}
              className={`tile font-display text-xl w-11 h-11 ${
                isRolling ? 'die-rolling' : ''
              } ${
                empty
                  ? 'tile-disabled border-dashed'
                  : parked
                    ? 'tile-disabled border-dashed border-amber-400/40'
                    : ''
              }`}
            >
              <span className="leading-none">{parked ? '·' : face ?? '·'}</span>
              {value != null && !parked && (
                <span className="tile-value">{value}</span>
              )}
            </button>
          )
        })}
      </div>
      <div className="flex items-center justify-center gap-3 min-h-[44px]">
        <SQButton variant="primary" onClick={onRoll} disabled={rollDisabled}>
          {rollsThisTurn === 0 ? 'Roll' : 'Re-roll'}
        </SQButton>
        <span className="text-xs opacity-70 whitespace-nowrap">
          Roll {rollsThisTurn}/{ROLLS_PER_TURN}
        </span>
      </div>
    </div>
  )
}

export { DIE_COUNT }
