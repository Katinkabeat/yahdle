import { useNavigate } from 'react-router-dom'
import { atlanticYMD } from '../../lib/rng.js'

// Yahdle is a daily — same seed for everyone, one game per day.
// gameId = today's Atlantic-time YYYY-MM-DD.
export default function SoloPlayCard() {
  const navigate = useNavigate()
  const today = atlanticYMD()
  function handlePlay() { navigate(`/solo/${today}`) }
  return (
    <section className="card">
      <h2 className="font-display text-xl mb-1">🎲 Today's Yahdle</h2>
      <p className="text-sm opacity-80 mb-3">
        Roll 5 letter dice, push your luck with rerolls, spell into the scorecard.
      </p>
      <button type="button" className="btn-primary" onClick={handlePlay}>
        ▶ Play today
      </button>
    </section>
  )
}
