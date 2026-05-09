// ────────────────────────────────────────────────────────────
//  useStreak — current consecutive-day solo streak.
//
//  A streak day = a yahdle_solo_results row for that play_date.
//  Counts back from today (or yesterday if today not played yet),
//  so the streak doesn't break until midnight Atlantic passes.
//
//  Mirrors Snibble's pattern: client-side computation, no stored
//  counter. Cheap — only selects play_date.
// ────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { atlanticYMD } from '../lib/rng.js'

export function useStreak(userId, refreshKey = 0) {
  const [streak, setStreak] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!userId) return
    let active = true

    async function load() {
      try {
        const { data, error } = await supabase
          .from('yahdle_solo_results')
          .select('play_date')
          .eq('user_id', userId)
          .order('play_date', { ascending: false })
          .limit(120)
        if (error) throw error
        const dates = (data ?? []).map((r) => r.play_date)
        if (active) setStreak(computeStreak(dates))
      } catch (err) {
        console.error('[useStreak] load failed', err)
      } finally {
        if (active) setLoading(false)
      }
    }

    load()
    return () => { active = false }
  }, [userId, refreshKey])

  return { streak, loading }
}

function computeStreak(dates) {
  if (!dates.length) return 0
  const set = new Set(dates)
  const today = atlanticYMD()
  let cursor
  if (set.has(today)) {
    cursor = today
  } else {
    const yesterday = shiftDate(today, -1)
    if (!set.has(yesterday)) return 0
    cursor = yesterday
  }
  let count = 0
  while (set.has(cursor)) {
    count++
    cursor = shiftDate(cursor, -1)
  }
  return count
}

function shiftDate(yyyyMmDd, days) {
  const [y, m, d] = yyyyMmDd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  const yy = dt.getUTCFullYear()
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(dt.getUTCDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}
