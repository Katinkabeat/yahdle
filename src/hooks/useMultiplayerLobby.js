import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase.js'
import { useRealtimeChannel } from './useRealtimeChannel.js'

// Loads the current user's Yahdle multiplayer lobby state:
//   pendingInvites — friend invites where I'm invited and haven't accepted
//   sentInvites    — games I created and am waiting on (friend or open)
//   activeGames    — games in progress involving me
//   completed      — last 10 finished games involving me
//   openGames      — open (no invitee) waiting games NOT created by me,
//                    available to join via yahdle_join_open_game
// Returns { ...lists, opponents (id→profile), loading, reload }.
export function useMultiplayerLobby(userId) {
  const [pendingInvites, setPendingInvites] = useState([])
  const [sentInvites, setSentInvites] = useState([])
  const [pendingRematches, setPendingRematches] = useState([])
  const [incomingRematches, setIncomingRematches] = useState([])
  const [activeGames, setActiveGames] = useState([])
  const [completed, setCompleted] = useState([])
  const [openGames, setOpenGames] = useState([])
  const [opponents, setOpponents] = useState({})
  const [loading, setLoading] = useState(true)
  const initialLoadDone = useRef(false)
  const lastExpireSweep = useRef(0)

  const reload = useCallback(async () => {
    if (!userId) return
    // Only flash "Loading…" on the very first load. Subsequent refreshes
    // (realtime + polling) update silently behind the existing data.
    if (!initialLoadDone.current) setLoading(true)
    try {
      // Sweep stale invites at most once every 5 minutes — not on every reload.
      const now = Date.now()
      if (now - lastExpireSweep.current > 5 * 60_000) {
        lastExpireSweep.current = now
        supabase.rpc('yahdle_expire_stale_invites').then(() => {}, () => {})
      }

      // My games (created or invited) + the game_ids I'm seated in + open
      // games I might join. The created_by/invited filter alone MISSES open
      // games I joined: there I'm neither the creator nor in invited_user_ids
      // (join sets the legacy invited_user_id to the FIRST joiner, not me), so
      // the row never came back and the game vanished from my lobby once I
      // joined. Fetching my seated game_ids and merging closes that gap.
      const [{ data: games, error: gErr }, { data: open }, { data: seatRows }] = await Promise.all([
        supabase
          .from('yahdle_games')
          .select('*, yahdle_players(*)')
          .or(`created_by.eq.${userId},invited_user_id.eq.${userId},invited_user_ids.cs.{${userId}}`)
          .order('last_activity_at', { ascending: false }),
        supabase.rpc('yahdle_list_open_games'),
        supabase.from('yahdle_players').select('game_id').eq('user_id', userId),
      ])
      if (gErr) throw gErr

      // Pull the games I'm seated in that the created_by/invited query didn't
      // already return, then merge + dedupe by id.
      const byId = new Map((games ?? []).map(g => [g.id, g]))
      const missingIds = (seatRows ?? []).map(r => r.game_id).filter(id => !byId.has(id))
      if (missingIds.length > 0) {
        const { data: seated } = await supabase
          .from('yahdle_games')
          .select('*, yahdle_players(*)')
          .in('id', missingIds)
        for (const g of seated ?? []) byId.set(g.id, g)
      }
      const list = Array.from(byId.values())
        .sort((a, b) => new Date(b.last_activity_at) - new Date(a.last_activity_at))
      const amInvited = g => g.invited_user_id === userId || (g.invited_user_ids ?? []).includes(userId)
      const amPlayer  = g => (g.yahdle_players ?? []).some(p => p.user_id === userId)
      const pending = list.filter(g => g.status === 'waiting' && amInvited(g) && !amPlayer(g))
      // Any waiting game I'm seated in — as the creator OR as a player who
      // already joined a not-yet-full N-player game. Without amPlayer here, a
      // joiner's game falls into no bucket and vanishes from their lobby until
      // it fills (creator still saw it via created_by).
      const sent    = list.filter(g => g.status === 'waiting' && amPlayer(g))
      const active = list.filter(g => g.status === 'active')
      // A rematch I've requested but my opponent hasn't accepted yet: a
      // finished game flagged with my request and no new game spawned. Surface
      // it like a sent invite ("waiting on them") rather than buried in the
      // completed list.
      const isMyPendingRematch = g =>
        g.status === 'finished' && g.rematch_requested_by === userId && !g.rematch_new_game_id
      const rematches = list.filter(isMyPendingRematch)
      // The mirror of the above: a rematch my OPPONENT requested that I haven't
      // accepted yet. The accept/decline UI otherwise lives only on the finished
      // game's game-over screen — once I'm back in the lobby I had nowhere to
      // act on it. Surface it like a pending invite (Accept / Decline). 1v1 only
      // (the handshake RPCs reject N-player games).
      const isIncomingRematch = g =>
        g.status === 'finished' && !g.rematch_new_game_id &&
        g.rematch_requested_by && g.rematch_requested_by !== userId &&
        (g.yahdle_players ?? []).some(p => p.user_id === userId)
      const incoming = list.filter(isIncomingRematch)
      const finished = list
        .filter(g => g.status === 'finished' && !isMyPendingRematch(g) && !isIncomingRematch(g))
        .slice(0, 10)
      const openList = open ?? []

      // Collect opponent ids for profile lookup. Open-games creator
      // profiles already come back via yahdle_list_open_games, so we
      // only need to look up profiles for "my games" here.
      const otherIds = new Set()
      for (const g of list) {
        if (g.created_by && g.created_by !== userId) otherIds.add(g.created_by)
        if (g.invited_user_id && g.invited_user_id !== userId) otherIds.add(g.invited_user_id)
        for (const iid of g.invited_user_ids ?? []) if (iid && iid !== userId) otherIds.add(iid)
        for (const p of g.yahdle_players ?? []) if (p.user_id && p.user_id !== userId) otherIds.add(p.user_id)
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
      setPendingRematches(rematches)
      setIncomingRematches(incoming)
      setActiveGames(active)
      setCompleted(finished)
      setOpenGames(openList)
      setOpponents(oppMap)
    } catch (err) {
      console.error('[useMultiplayerLobby] failed', err)
    } finally {
      setLoading(false)
      initialLoadDone.current = true
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

  return { pendingInvites, sentInvites, pendingRematches, incomingRematches, activeGames, completed, openGames, opponents, loading, reload }
}
