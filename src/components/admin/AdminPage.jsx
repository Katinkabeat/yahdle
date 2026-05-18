import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  SQLobbyShell,
  SQLobbyHeader,
} from '../../../../rae-side-quest/packages/sq-ui'
import AvatarMenu from '../lobby/AvatarMenu.jsx'
import HeaderRight from '../HeaderRight.jsx'
import CloseGamesPanel from './CloseGamesPanel.jsx'

// Admin panel — Close Games + playtest guide.
export default function AdminPage({ session, profile, isAdmin }) {
  const navigate = useNavigate()

  // Hard gate: non-admins shouldn't reach this URL.
  useEffect(() => {
    if (!isAdmin) navigate('/', { replace: true })
  }, [isAdmin, navigate])

  if (!isAdmin) return null

  return (
    <SQLobbyShell
      header={
        <SQLobbyHeader
          title="Yahdle"
          avatarSlot={<AvatarMenu profile={profile} />}
          rightSlot={<HeaderRight isAdmin={isAdmin} />}
        />
      }
    >
      <button
        type="button"
        onClick={() => navigate('/')}
        className="text-sm font-bold opacity-70 hover:opacity-100 self-start"
      >
        ← Back to lobby
      </button>

      <CloseGamesPanel />

      <section className="card">
        <h2 className="font-display text-xl mb-2">📖 Admin Guide</h2>
        <details className="text-sm">
          <summary className="cursor-pointer opacity-80 hover:opacity-100">Tap to expand</summary>
          <div className="mt-3 space-y-3 leading-relaxed">

            <div>
              <h3 className="font-bold mb-1">Daily seed</h3>
              <p>
                Every player on a given date sees the same dice and rolls. The
                seed is built from the URL date plus an Atlantic-time rollover.
                Two admins on the same date get identical puzzles — compare
                strategy by comparing scores.
              </p>
            </div>

            <div>
              <h3 className="font-bold mb-1">↻ Reset (top-right of game page)</h3>
              <p>
                Wipes the saved game AND rolls a fresh puzzle variant. Each tap
                = a different starting hand. The new variant persists across
                reloads until you tap Reset again. Clear the
                <code className="px-1 opacity-80">yahdle:salt:*</code> keys in
                localStorage to return to the canonical daily.
              </p>
            </div>

            <div>
              <h3 className="font-bold mb-1">URL tricks for testing</h3>
              <p>The <code className="px-1 opacity-80">gameId</code> in the URL is just a string fed into the seed:</p>
              <ul className="list-disc pl-5 mt-1 space-y-0.5">
                <li><code className="opacity-80">/solo/test-1</code>, <code className="opacity-80">/solo/test-2</code> — fresh puzzles</li>
                <li><code className="opacity-80">/solo/2026-05-09</code> — tomorrow's puzzle</li>
                <li><code className="opacity-80">/solo/2026-05-07</code> — yesterday's puzzle</li>
              </ul>
            </div>

            <div>
              <h3 className="font-bold mb-1">localStorage layout</h3>
              <ul className="list-disc pl-5 space-y-0.5">
                <li><code className="opacity-80">yahdle:state:&lt;userId&gt;:&lt;gameId&gt;</code> — turn / score / dice / builder</li>
                <li><code className="opacity-80">yahdle:salt:&lt;userId&gt;:&lt;gameId&gt;</code> — admin Reset salt</li>
              </ul>
              <p className="mt-1">Wipe everything Yahdle has stored: devtools → Application → Local Storage → filter on <code className="px-1 opacity-80">yahdle:</code> → delete.</p>
            </div>

            <div>
              <h3 className="font-bold mb-1">Letter pool</h3>
              <p>
                18 letters live on the dice: A E I O U + T R S N L D H M C P B W G.
                F K J Q V X Y Z are not on any die — words containing them can't
                be spelled.
              </p>
            </div>

            <div>
              <h3 className="font-bold mb-1">Categories cheat sheet</h3>
              <ul className="list-disc pl-5 space-y-0.5">
                <li>3-Letter / 4-Letter — any word of that length</li>
                <li>Lexicon — uses all dice (currently 6 letters)</li>
                <li>Double Up — repeated letter</li>
                <li>Vowel Heavy / Consonant Heavy — 3+ vowels / 4+ cons</li>
                <li>High Value — ≥10 pts · Low Ball — ≤4 pts</li>
                <li>Bookends — same start & end · No Repeats — all unique</li>
                <li>Long Shot — 5-letter, ≥12 pts · Wild Card — anything</li>
              </ul>
            </div>

            <div>
              <h3 className="font-bold mb-1">When playtesting reveals a balance issue</h3>
              <ul className="list-disc pl-5 space-y-0.5">
                <li><b>Category never fires:</b> count valid words via the dictionary; lower threshold if &lt;10.</li>
                <li><b>Always fires:</b> raise threshold or rotate it out.</li>
                <li><b>Dice feel impossible:</b> concentrate the alphabet further (drop letters, bump common-letter copies).</li>
                <li><b>Multiple unfilled categories at game end:</b> add easier categories or soften thresholds.</li>
              </ul>
            </div>

          </div>
        </details>
      </section>

    </SQLobbyShell>
  )
}
