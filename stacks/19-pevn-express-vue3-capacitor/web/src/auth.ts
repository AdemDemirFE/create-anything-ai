/**
 * Session probe for the router guard: /api/v1/home answers 401 when there
 * is no valid session. The result is cached until reset (logout flips it).
 * The server re-checks every request anyway — this is convenience only.
 */
let authed: boolean | null = null

export function resetAuthCache(): void {
  authed = null
}

export async function isAuthenticated(): Promise<boolean> {
  if (authed !== null) return authed
  try {
    const resp = await fetch('/api/v1/home', { credentials: 'same-origin' })
    authed = resp.ok
  } catch {
    authed = false
  }
  return authed
}
