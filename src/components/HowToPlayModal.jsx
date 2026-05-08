import { SQModal } from '../../../rae-side-quest/packages/sq-ui'

export default function HowToPlayModal({ open, onClose }) {
  return (
    <SQModal open={open} onClose={onClose} title="How to play Yahdle">
      <div className="space-y-3 text-sm leading-relaxed">

        <section>
          <h3 className="font-display text-base mb-1">The goal</h3>
          <p>
            Roll 6 letter dice, spell a word, score it into one of 12 scorecard
            categories. Fill all 12 categories for the highest total.
          </p>
        </section>

        <section>
          <h3 className="font-display text-base mb-1">A turn</h3>
          <ol className="list-decimal pl-5 space-y-1.5">
            <li>
              Tap <b>Roll</b>. All 6 dice show new letters. Each letter has its
              Scrabble value in the corner.
            </li>
            <li>
              Tap a die to move its letter into the <b>word area</b>. That
              letter is now part of your word AND locked from re-rolls.
            </li>
            <li>
              Tap <b>Re-roll</b> to re-roll any dice still in the rack. You get
              up to 3 rolls per turn.
            </li>
            <li>
              Repeat — keep moving letters into the word area between rolls.
              When you're happy, tap a category to score.
            </li>
          </ol>
        </section>

        <section>
          <h3 className="font-display text-base mb-1">In the word area</h3>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>
              <b>Tap a letter</b> to highlight it, then tap a second letter to
              <b> swap</b> their positions. Useful for anagramming.
            </li>
            <li>
              Tap the <b>×</b> on a letter to remove it. The die goes back to
              the rack at the same face — you can re-roll it or move it back in.
            </li>
            <li>
              Tap <b>clear</b> to empty the word area entirely.
            </li>
          </ul>
        </section>

        <section>
          <h3 className="font-display text-base mb-1">Scoring</h3>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>
              Word score = sum of Scrabble letter values. No multipliers.
            </li>
            <li>
              Tap a category cell. If your word fits, you score it instantly.
            </li>
            <li>
              If your word <i>doesn't</i> fit (or you have no word), the cell
              asks <b>Take a 0?</b> — confirm to forfeit the category, or cancel
              and try a different one.
            </li>
            <li>
              Each category can only be filled once. Game ends after all 12.
            </li>
          </ul>
        </section>

        <section>
          <h3 className="font-display text-base mb-1">The 12 categories</h3>
          <ul className="list-disc pl-5 space-y-0.5">
            <li><b>3-Letter</b> — any 3-letter word</li>
            <li><b>4-Letter</b> — any 4-letter word</li>
            <li><b>Lexicon</b> — uses all 6 dice (a 6-letter word)</li>
            <li><b>Double Up</b> — has a repeated letter</li>
            <li><b>Vowel Heavy</b> — 3+ vowels</li>
            <li><b>Consonant Heavy</b> — 4+ consonants</li>
            <li><b>High Value</b> — ≥10 pts</li>
            <li><b>Low Ball</b> — ≤4 pts</li>
            <li><b>Bookends</b> — same first and last letter</li>
            <li><b>No Repeats</b> — every letter different</li>
            <li><b>Long Shot</b> — 5-letter word, ≥12 pts</li>
            <li><b>Wild Card</b> — anything goes</li>
          </ul>
        </section>

        <section>
          <h3 className="font-display text-base mb-1">Daily puzzle</h3>
          <p>
            Every player on a given day gets the same dice and the same rolls.
            Compare scores with friends. New puzzle every day at midnight
            Atlantic time.
          </p>
        </section>

        <section>
          <h3 className="font-display text-base mb-1">Tips</h3>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>
              Move vowels into the word area early — they're often the hardest
              to re-roll back if you lose them.
            </li>
            <li>
              Watch for <b>Bookends</b> opportunities (start and end with the
              same letter) — they sneak up.
            </li>
            <li>
              Save tough categories like <b>Lexicon</b> and <b>Long Shot</b> for
              rolls with a useful spread of letters. Use <b>Wild Card</b> when
              nothing else fits.
            </li>
            <li>
              No word? Use <b>clear</b>, then double-check the rack — the dice
              never include J, K, Q, V, X, Y, or Z.
            </li>
          </ul>
        </section>

      </div>
    </SQModal>
  )
}
