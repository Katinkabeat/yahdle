import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase.js'
import { useRealtimeChannel } from './useRealtimeChannel.js'

// Loads the current user's Yahdle multiplayer lobby state:
//   pendingInvites — games where I'm invited and haven't accepted
//   activeGames    — games in progress involving me
//   completed      — last 10 finished games involving me
// Returns { ...lists, opponents (id→profile), loading, reload }.
export function useMultiplayerLobby(userId) {
  const [pendingInvites, setPendingInvites] = useState([])
  const [sentInvites, setSentInvites] = useState([])
  const [activeGames, setActiveGames] = useState([])
  const [completed, setCompleted] = useState([])
  const [opponents, setOpponents] = useState({})
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    if (!userId) return
    setLoading(true)
    try {
      // Best-effort cleanup of stale invites so they don't render.
      supabase.rpc('yahdle_expire_stale_invites').then(() => {}, () => {})

      const { data: games, error: gErr } = await supabase
        .from('yahdle_games')
        .select('*, yahdle_players(*)')
        .or(`created_by.eq.${userId},invited_user_id.eq.${userId}`)
        .order('last_activity_at', { ascending: false })
      if (gErr) throw gErr

      const list = games ?? []
      const pending = list.filter(g => g.status === 'waiting' && g.invited_user_id === userId)
      const sent    = list.filter(g => g.status === 'waiting' && g.created_by === userId)
      const active = list.filter(g => g.status === 'active')
      const finished = list.filter(g => g.status === 'finished').slice(0, 10)

      // Collect opponent ids for profile lookup.
      const otherIds = new Set()
      for (const g of list) {
        if (g.created_by && g.created_by !== userId) otherIds.add(g.created_by)
        if (g.invited_user_id && g.invited_user_id !== userId) otherIds.add(g.invited_user_id)
      }

      let oppMap = {}
      if (otherIds.size > 0) {
        const { data: profs } = await supabase
          .from('profiles')
          .select('id, username, avatar_hue')
          .in('id', Array.from(otherIds))
        for (const p of profs ?? []) oppMap[p.id] = p
      }

      setPendingInvites(pending)
      setSentInvites(sent)
      setActiveGames(active)
      setCompleted(finished)
      setOpponents(oppMap)
    } catch (err) {
      console.error('[useMultiplayerLobby] failed', err)
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => { reload() }, [reload])

  useRealtimeChannel({
    channelName: `lobby_yahdle_${userId}`,
    subscriptions: userId ? [
      { event: '*', schema: 'public', table: 'yahdle_games', filter: `created_by=eq.${userId}` },
      { event: '*', schema: 'public', table: 'yahdle_games', filter: `invited_user_id=eq.${userId}` },
      { event: '*', schema: 'public', table: 'yahdle_players', filter: `user_id=eq.${userId}` },
    ] : [],
    onChange: reload,
    pollMs: 30_000,
    enabled: !!userId,
  })

  return { pendingInvites, sentInvites, activeGames, completed, opponents, loading, reload }
}
