// useRealtimeChannel — subscribe to one or more Supabase realtime channels
// with the connection-resilience patterns every SideQuest game needs:
//
//   1. Postgres-changes subscription (live updates from one or more tables)
//   2. Polling fallback (in case the realtime socket is down — common on
//      free-tier Supabase quotas)
//   3. Visibility/focus refresh + auto-reconnect (so a phone waking up
//      after a long break catches up immediately and rebinds the channel)
//   4. Cleanup on unmount or dependency change
//
// Pass an array of `subscriptions` to listen on multiple tables or events
// for the same game. The handler is called with the Supabase payload.
//
// Example (multiplayer game page):
//
//   const channelRef = useRef(null)
//   useRealtimeChannel({
//     channelName: `game-${gameId}`,
//     channelRef,
//     subscriptions: [
//       { event: 'UPDATE', schema: 'public', table: 'yahdle_games',   filter: `id=eq.${gameId}` },
//       { event: '*',      schema: 'public', table: 'yahdle_players', filter: `game_id=eq.${gameId}` },
//     ],
//     onChange: () => loadGame(),
//     pollMs: 10_000,
//     enabled: !!gameId,
//   })
//
// IMPORTANT: if your handler's data (e.g. `loadGame`) ever changes
// identity, wrap it in useCallback so this hook doesn't re-subscribe on
// every render. The default poll interval is 10 seconds — match-style
// games may want longer (30s+); rapid-turn games can stay at 10s.
//
// REPLICA IDENTITY FULL — Supabase realtime needs replica identity full
// on any table whose `filter` uses a non-primary-key column (e.g.
// `game_id` on a players table). Set this in your migration:
//
//   alter table public.yahdle_players replica identity full;

import { useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase.js'

export function useRealtimeChannel({
  channelName,
  channelRef,
  subscriptions,
  onChange,
  pollMs = 10_000,
  enabled = true,
}) {
  // Stash the latest handler in a ref so we don't rebind the channel
  // every render just because the caller re-created its callback.
  const onChangeRef = useRef(onChange)
  useEffect(() => { onChangeRef.current = onChange }, [onChange])

  useEffect(() => {
    if (!enabled || !channelName) return

    const localChannelRef = channelRef ?? { current: null }

    function subscribe() {
      if (localChannelRef.current) {
        supabase.removeChannel(localChannelRef.current)
      }
      let ch = supabase.channel(channelName)
      for (const sub of subscriptions) {
        ch = ch.on('postgres_changes', sub, (payload) => {
          onChangeRef.current?.(payload)
        })
      }
      localChannelRef.current = ch.subscribe()
    }

    subscribe()

    // Polling fallback: refreshes while the tab is visible even if the
    // realtime socket dropped silently.
    const poll = setInterval(() => {
      if (document.visibilityState === 'visible') onChangeRef.current?.()
    }, pollMs)

    // On visibility/focus, refresh AND reconnect the channel if it dropped.
    function handleVisible() {
      if (document.visibilityState !== 'visible') return
      onChangeRef.current?.()
      if (
        !localChannelRef.current ||
        localChannelRef.current.state !== 'joined'
      ) {
        subscribe()
      }
    }
    document.addEventListener('visibilitychange', handleVisible)
    window.addEventListener('focus', handleVisible)

    return () => {
      if (localChannelRef.current) {
        supabase.removeChannel(localChannelRef.current)
        localChannelRef.current = null
      }
      clearInterval(poll)
      document.removeEventListener('visibilitychange', handleVisible)
      window.removeEventListener('focus', handleVisible)
    }
    // Stringify subscriptions so callers can inline the array literal
    // without triggering needless re-subscribes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelName, enabled, pollMs, JSON.stringify(subscriptions)])
}
