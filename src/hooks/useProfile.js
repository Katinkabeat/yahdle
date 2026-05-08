// useProfile — read the user's SideQuest profile (username + avatar hue)
// from the shared `profiles` table that every SQ game reads from. Returns
// `null` while loading or if no row exists. Re-fires when `userId` changes.
//
// Note: App.jsx already loads the signed-in user's full profile once and
// passes it to each page as a prop. Use this hook for ANY OTHER user
// whose profile you need to display (opponent, lobby chips, etc.) so you
// don't bounce a separate query per render.

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'

export function useProfile(userId) {
  const [profile, setProfile] = useState(null)
  useEffect(() => {
    if (!userId) { setProfile(null); return }
    let active = true
    supabase
      .from('profiles')
      .select('id, username, avatar_hue')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data }) => { if (active) setProfile(data ?? null) })
    return () => { active = false }
  }, [userId])
  return profile
}
