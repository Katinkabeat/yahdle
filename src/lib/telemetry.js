// Fire-and-forget telemetry for Yahdle.
// Writes a row to public.sq_events if a user is signed in; silent no-op otherwise.
// Never awaits from the caller, never throws. See rae-side-quest/SQ_PHASED_PLAN.md
// (Phase 2) for the broader plan.
//
// Usage:
//   import { logEvent } from './lib/telemetry.js'
//   logEvent('move_played', { score: 42 })

import { supabase } from './supabase.js'

const GAME = 'yahdle'

export function logEvent(event, payload = {}) {
  (async () => {
    try {
      const { data } = await supabase.auth.getUser()
      const userId = data?.user?.id
      if (!userId) return
      await supabase.from('sq_events').insert({
        user_id: userId,
        game: GAME,
        event,
        payload,
      })
    } catch {
      // Telemetry must never break gameplay.
    }
  })()
}
