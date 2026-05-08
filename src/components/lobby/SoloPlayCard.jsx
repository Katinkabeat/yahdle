import { useNavigate } from 'react-router-dom'

// Top lobby card — entry point into a solo game. Default behavior is to
// generate a fresh game id and navigate to /game/:id; replace with whatever
// solo-launch flow the game needs (daily puzzle, free-play seed, etc.).
export default function SoloPlayCard() {
  const navigate = useNavigate()

  // TODO replace with the real solo-game launcher (daily seed, new game id, etc.)
  function handlePlay() {
    const id = crypto.randomUUID()
    navigate(`/solo/${id}`)
  }

  return (
    <section className="card">
      <h2 className="font-display text-xl mb-1">🌸 Solo</h2>
      <p className="text-sm opacity-80 mb-3">
        {/* TODO write the solo pitch for Yahdle */}
        Play on your own — no opponent needed.
      </p>
      <button type="button" className="btn-primary" onClick={handlePlay}>
        ▶ Play Solo
      </button>
    </section>
  )
}
