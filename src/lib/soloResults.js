import { supabase } from './supabase.js'

// Server-side "did I already play this daily?" check. Mirrors Rungles'
// fetchTodayDaily so re-entry can be gated cross-device (localStorage alone
// misses other browsers/devices). Returns the recorded row or null.
export async function fetchDailyResult(userId, playDate) {
  const { data, error } = await supabase
    .from('yahdle_solo_results')
    .select('play_date, score')
    .eq('user_id', userId)
    .eq('play_date', playDate)
    .maybeSingle()
  if (error) throw error
  return data ?? null
}
