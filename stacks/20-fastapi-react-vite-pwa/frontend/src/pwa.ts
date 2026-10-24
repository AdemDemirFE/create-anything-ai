/**
 * PWA registration (see README §PWA and public/sw.js for the strategy).
 *
 * Registers the service worker only in production builds and only when the
 * browser supports it. In dev, registering would serve a stale precache over
 * Vite's HMR module graph, so it is skipped.
 *
 * Offline strategy summary (full text in README):
 * - App shell + static assets: cache-first (stale-while-revalidate) → the
 *   four screens stay usable offline.
 * - /api/*: network-only; session-backed data is never cached. Offline API
 *   failures surface through the normal error states.
 */

/// <reference types="vite/client" />

export function registerServiceWorker(): void {
  if (import.meta.env.DEV) return
  if (!('serviceWorker' in navigator)) return

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Registration failure must never break the app; offline support is a
      // progressive enhancement.
    })
  })
}
