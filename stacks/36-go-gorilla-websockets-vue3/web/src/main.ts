import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'
import './style.css'

// Session probe for the router guard: /api/v1/me answers 401 when there is
// no valid session. The result is cached per navigation (not per session —
// logout flips it).
let authed: boolean | null = null

export function resetAuthCache() {
  authed = null
}

export async function isAuthenticated(): Promise<boolean> {
  if (authed !== null) return authed
  try {
    const resp = await fetch('/api/v1/me', { credentials: 'same-origin' })
    authed = resp.ok
  } catch {
    authed = false
  }
  return authed
}

router.beforeEach(async (to) => {
  if (!to.meta.requiresAuth) return true
  const ok = await isAuthenticated()
  if (!ok) return { name: 'auth' }
  return true
})

createApp(App).use(router).mount('#app')
