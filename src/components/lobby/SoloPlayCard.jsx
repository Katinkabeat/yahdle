import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase.js'
import { atlanticYMD } from '../../lib/rng.js'
import { useStreak } from '../../hooks/useStreak.js'

// Yahdle is a daily — same seed for everyone, one game per day.
// gameId = today's Atlantic-time YYYY-MM-DD.
export default function SoloPlayCard({ session }) {
  const navigate = useNavigate()
  const today = atlanticYMD()
  const userId = session?.user?.id
  const { streak } = useStreak(userId)

  // Reflect whether today's daily is already done, so the card offers a
  // "view today's result" path instead of "play" (matches Rungles' lobby).
  const [playedToday, setPlayedToday] = useState(false)
  useEffect(() => {
    if (!userId) return
    let active = true
    supabase
      .from('yahdle_solo_results')
      .select('play_date')
      .eq('user_id', userId)
      .eq('play_date', today)
      .maybeSingle()
      .then(({ data }) => { if (active) setPlayedToday(!!data) })
    return () => { active = false }
  }, [userId, today])

  function handlePlay() { navigate(`/solo/${today}`) }
  return (
    <section className="card relative">
      {streak > 0 && (
        <span
          className="absolute top-3 right-3 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-wordy-200 text-wordy-700 text-xs font-bold"
          title={`${streak}-day streak`}
        >
          🔥 {streak}
        </span>
      )}
      <h2 className="font-display text-xl mb-1">🎲 Today's Yahdle</h2>
      <p className="text-sm opacity-80 mb-3">
        Roll 6 letter dice, push your luck with rerolls, spell into the scorecard.
      </p>
      <button type="button" className="btn-primary" onClick={handlePlay}>
        {playedToday ? '↗ View today\'s result' : '▶ Play today'}
      </button>
    </section>
  )
}
