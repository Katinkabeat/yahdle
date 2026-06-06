// Yahdle Service Worker — handles push notifications.
// Bump CACHE_VERSION on every user-visible deploy so PWAs pick up the new SW.

const CACHE_VERSION = 'yahdle-v4'

self.addEventListener('push', (event) => {
  let data = { title: 'Yahdle', body: "It's your turn!" }
  try {
    if (event.data) data = event.data.json()
  } catch {
    // fallback to defaults
  }

  const tag = data.tag || 'yahdle-turn'

  const options = {
    body: data.body,
    icon: '/yahdle/favicon.svg',
    badge: '/yahdle/favicon.svg',
    tag,
    renotify: true,
    data: { url: data.url || '/yahdle/' },
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      const targetUrl = data.url || ''
      // A push is the fastest, most reliable signal that game state changed
      // (the realtime socket is throttled/suspended while a tab is
      // backgrounded). Tell every open Yahdle client to refresh now, so the
      // page is up to date the moment it's looked at — no waiting on the
      // socket or the poll. Costs nothing extra: it's the same refresh the
      // poll would do, just sooner.
      for (const c of windowClients) {
        if (c.url.includes('/yahdle/')) c.postMessage({ type: 'REFRESH', url: targetUrl })
      }
      const hasFocusedClient = windowClients.some(
        c => c.visibilityState === 'visible' && c.focused
             && targetUrl && c.url.includes(targetUrl)
      )
      if (hasFocusedClient) return
      return self.registration.showNotification(data.title, options)
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = event.notification.data?.url || '/yahdle/'

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes('/yahdle/') && 'focus' in client) {
          return client.focus().then((focusedClient) => {
            focusedClient.postMessage({ type: 'NAVIGATE', url: targetUrl })
          })
        }
      }
      return clients.openWindow(targetUrl)
    })
  )
})

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim())
})
