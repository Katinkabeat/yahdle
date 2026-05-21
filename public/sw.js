// Yahdle Service Worker — handles push notifications.
// Bump CACHE_VERSION on every user-visible deploy so PWAs pick up the new SW.

const CACHE_VERSION = 'yahdle-v2'

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
