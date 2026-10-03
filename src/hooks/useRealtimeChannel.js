// useRealtimeChannel — subscribe to a private Supabase Broadcast topic
// with the connection-resilience patterns every SideQuest game needs:
//
//   1. Broadcast-from-database subscription (the yahdle_broadcast_game_change
//      trigger in supabase/migrations/yahdle_realtime_broadcast.sql sends
//      event 'change' via realtime.send; no publication / replica identity)
//   2. Polling fallback (in case the realtime socket is down — common on
//      free-tier Supabase quotas)
//   3. Visibility/focus refresh + auto-reconnect (so a phone waking up
//      after a long break catches up immediately and rebinds the channel)
//   4. Cleanup on unmount or dependency change
//
// Topics: `yahdle:game:<game_id>` (members of that game) and
// `yahdle:user:<user_id>` (lobby feed). Access is enforced by RLS policies
// on realtime.messages. The handler is called with the broadcast payload:
//   { table, event, game_id, user_id?, status, new? }
//
// Example (multiplayer game page):
//
//   useRealtimeChannel({
//     topic: `yahdle:game:${gameId}`,
//     onChange: () => loadGame(),
//     pollMs: 10_000,
//     enabled: !!gameId,
//   })
//
// IMPORTANT: if your handler's data (e.g. `loadGame`) ever changes
// identity, wrap it in useCallback so this hook doesn't re-subscribe on
// every render. The default poll interval is 10 seconds — match-style
// games may want longer (30s+); rapid-turn games can stay at 10s.

import { useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase.js'

export function useRealtimeChannel({
  topic,
  channelRef,
  onChange,
  pollMs = 10_000,
  enabled = true,
}) {
  // Stash the latest handler in a ref so we don't rebind the channel
  // every render just because the caller re-created its callback.
  const onChangeRef = useRef(onChange)
  useEffect(() => { onChangeRef.current = onChange }, [onChange])

  useEffect(() => {
    if (!enabled || !topic) return

    const localChannelRef = channelRef ?? { current: null }

    function subscribe() {
      if (localChannelRef.current) {
        supabase.removeChannel(localChannelRef.current)
      }
      localChannelRef.current = supabase
        .channel(topic, { config: { private: true } })
        .on('broadcast', { event: 'change' }, ({ payload }) => {
          onChangeRef.current?.(payload)
        })
        .subscribe()
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
  }, [topic, enabled, pollMs])
}
