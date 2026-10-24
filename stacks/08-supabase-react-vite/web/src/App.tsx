import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { getSession, logout, toUserView, type AuthUserView } from './lib/authApi'

/**
 * App shell: navbar + auth guard. The session is resolved once from the real
 * supabase-js auth state (localStorage-backed); protected routes render only
 * when GoTrue confirms a live session, otherwise navigation falls back to
 * /login. This is the client-side half of "require authentication at the
 * backend as well as in client routing" — the backend half is RLS itself.
 */
export function App() {
  const navigate = useNavigate()
  const location = useLocation()
  const [user, setUser] = useState<AuthUserView | null>(null)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    let cancelled = false
    getSession()
      .then((envelope) => {
        if (cancelled) return
        setUser(envelope.ok && envelope.data ? toUserView(envelope.data.user) : null)
      })
      .catch(() => {
        if (!cancelled) setUser(null)
      })
      .finally(() => {
        if (!cancelled) setChecking(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const onSignOut = useCallback(async () => {
    // Local state is cleared regardless of the network result: after
    // signOut() the local session is gone even if the call failed.
    await logout()
    setUser(null)
    navigate('/login')
  }, [navigate])

  const isProtected = location.pathname.startsWith('/apps')
  const awaitingAuth = checking && isProtected

  // Client-side guard: render the child route only while a session exists.
  // RLS remains the real authorization layer server-side.
  const outlet = user ? <Outlet context={{ user, setUser }} /> : <Navigate to="/login" replace />

  return (
    <div>
      <nav aria-label="Primary">
        <span>Stack 08 · Supabase direct</span>
        {user && (
          <>
            <Link to="/apps">Apps</Link>
            <span aria-live="polite">Signed in as {user.email}</span>
            <button type="button" onClick={onSignOut}>
              Log out
            </button>
          </>
        )}
      </nav>

      {awaitingAuth ? <p aria-busy="true">Checking session…</p> : outlet}
    </div>
  )
}
