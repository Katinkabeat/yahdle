import { useState, useRef, useLayoutEffect, useEffect } from 'react'
import { SQButton } from '../../../../rae-side-quest/packages/sq-ui'
import { DICE, DIE_COUNT, ROLLS_PER_TURN } from '../../lib/dice.js'
import { LETTER_VALUES } from '../../lib/scoring.js'

// Shared dice rack + Roll control for Solo + Multi.
//
// faces: text[] of length DIE_COUNT (entries may be null before first roll
//   or for empty slots). Parked dice still occupy their slot — we render
//   them as faded "·" placeholders so the rack stays a stable 6-wide layout.
// inBuilder: boolean[] of length DIE_COUNT — true if that die is in the
//   word builder (i.e. parked).
// rollsThisTurn: 0/1/2/3 — also the animation trigger, see DieTile.
// onTapDie(i): tap a rack die to move it to the word area
// onRoll(): tap the Roll button
// disabled: external disable (e.g. waiting on opponent in MP)

// Reel animation: how many decoy letters scroll past before the real face,
// and how long the whole travel takes. The easing decelerates hard at the
// end so it reads as a mechanism settling rather than a linear scroll.
const REEL_DECOYS = 7
const REEL_MS = 700
const REEL_EASE = 'cubic-bezier(.15,.85,.25,1)'

function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

// One die. Owns its own roll animation: when rollsThisTurn goes UP and this
// die isn't parked, a strip of letters drawn from THIS die's real face set
// scrolls up through the tile and decelerates onto the new face.
//
// Driven by the roll counter rather than a separate "animating" flag on
// purpose. The old flag was set optimistically on tap, so in MP it could
// start (and finish) before the server returned the new faces; and two rolls
// inside its 500ms window left the flag true→true, which never restarted the
// animation. The counter changes exactly once per roll, in the same update
// that delivers the faces, so the animation always matches the real result.
//
// It also has to run when the face doesn't change: landing on the letter you
// already had is a 1-in-8 event, and without the scroll it's indistinguishable
// from the button doing nothing.
function DieTile({ index, face, parked, disabled, rollsThisTurn, onTap }) {
  const btnRef = useRef(null)
  const stripRef = useRef(null)
  const prevRoll = useRef(rollsThisTurn)
  const [reel, setReel] = useState(null) // { id, letters, cell } | null

  useLayoutEffect(() => {
    const prev = prevRoll.current
    prevRoll.current = rollsThisTurn
    // Only a fresh roll animates. A new turn resets the counter to 0, which
    // must not read as a roll.
    if (rollsThisTurn <= prev) return
    if (parked || face == null) return
    // Reduced motion still needs SOME signal, or the same-face re-roll goes
    // right back to looking like a dead button for anyone who has it on. A
    // brief fade carries "this die just rolled" without travel or spin.
    if (prefersReducedMotion()) {
      btnRef.current?.animate(
        [{ opacity: 1 }, { opacity: 0.35 }, { opacity: 1 }],
        { duration: 260, easing: 'ease-in-out' },
      )
      return
    }
    // clientHeight excludes the tile's border, so cells line up with the
    // visible window even if the tile is resized later.
    const cell = btnRef.current?.clientHeight
    if (!cell) return
    const die = DICE[index] ?? []
    const letters = []
    for (let k = 0; k < REEL_DECOYS; k++) {
      letters.push(die[Math.floor(Math.random() * die.length)])
    }
    letters.push(face)
    setReel(r => ({ id: (r?.id ?? 0) + 1, letters, cell }))
  }, [rollsThisTurn, parked, face, index])

  useEffect(() => {
    if (!reel || !stripRef.current) return
    const travel = (reel.letters.length - 1) * reel.cell
    const anim = stripRef.current.animate(
      [{ transform: 'translateY(0)' }, { transform: `translateY(-${travel}px)` }],
      { duration: REEL_MS, easing: REEL_EASE, fill: 'forwards' },
    )
    anim.onfinish = () => setReel(null)
    // Backstop: the strip shows decoy letters, so it must never be what's
    // left on screen. onfinish doesn't fire while the document is hidden
    // (the animation is paused), so a tab backgrounded mid-roll would come
    // back to a die frozen part-way up the reel. Clearing on a timer drops
    // it straight to the real face instead.
    const bail = setTimeout(() => setReel(null), REEL_MS + 250)
    return () => { clearTimeout(bail); anim.cancel() }
  }, [reel])

  const empty = face == null
  const value = face ? LETTER_VALUES[face] : null

  return (
    <button
      ref={btnRef}
      type="button"
      onClick={() => empty || parked ? null : onTap(index)}
      disabled={empty || parked || disabled}
      className={`tile font-display text-xl w-11 h-11 overflow-hidden ${
        empty
          ? 'tile-disabled border-dashed'
          : parked
            ? 'tile-disabled border-dashed border-amber-400/40'
            : ''
      }`}
    >
      {reel ? (
        <span
          key={reel.id}
          ref={stripRef}
          aria-hidden="true"
          className="absolute left-0 top-0 w-full"
          style={{ willChange: 'transform' }}
        >
          {reel.letters.map((l, k) => (
            <span
              key={k}
              className="flex items-center justify-center leading-none"
              style={{ height: `${reel.cell}px` }}
            >
              {l}
            </span>
          ))}
        </span>
      ) : (
        <>
          <span className="leading-none">{parked ? '·' : face ?? '·'}</span>
          {value != null && !parked && (
            <span className="tile-value">{value}</span>
          )}
        </>
      )}
    </button>
  )
}

export default function DiceRack({
  faces,
  inBuilder,
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
        {(faces ?? []).map((face, i) => (
          <DieTile
            key={i}
            index={i}
            face={face}
            parked={inBuilder[i]}
            disabled={disabled}
            rollsThisTurn={rollsThisTurn}
            onTap={onTapDie}
          />
        ))}
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
