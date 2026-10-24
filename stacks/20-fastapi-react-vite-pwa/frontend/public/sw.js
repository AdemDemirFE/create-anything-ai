/*
 * Stack 20 service worker — documented offline strategy (see README §PWA):
 *
 * - App shell (navigation requests + static assets): cache-first with
 *   background refresh (stale-while-revalidate). The SPA is a static build;
 *   serving the shell offline keeps every screen reachable.
 * - API calls (/api/*): network-only. Session auth and profile data must
 *   never be served stale from a cache; when offline, requests fail and the
 *   UI shows its error/empty states. No API response is ever cached.
 * - Non-GET API requests are never intercepted.
 * - The precache list contains only build-emitted shell assets; it never
 *   includes /api paths or anything user-specific.
 * - Old caches are deleted on activate; bumping VERSION triggers the cleanup.
 */

const VERSION = 'stack20-v1'
const SHELL_CACHE = `${VERSION}-shell`

const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-512-maskable.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== SHELL_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request

  // Never touch non-GET traffic (auth/session mutations, algorithm runs).
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  // API: network-only, pass-through. Failures surface in the UI as errors.
  if (url.pathname.startsWith('/api/')) return

  // Same-origin shell + assets: stale-while-revalidate.
  if (request.mode === 'navigate' || url.origin === self.location.origin) {
    event.respondWith(
      caches.open(SHELL_CACHE).then(async (cache) => {
        const cached = await cache.match(request, { ignoreSearch: request.mode === 'navigate' })
        const network = fetch(request)
          .then((response) => {
            if (response && response.status === 200 && response.type === 'basic') {
              cache.put(request, response.clone())
            }
            return response
          })
          .catch(() => cached)
        return cached || network
      }),
    )
  }
})
