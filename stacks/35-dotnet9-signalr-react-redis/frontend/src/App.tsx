import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { api } from './api/client'
import { createRealtimeConnection, type RunEvent } from './api/realtime'

/**
 * App shell: navbar + protected-route guard + live notification area.
 *
 * Session state is resolved once from GET /api/v1/me (the cookie is the
 * credential). Protected routes (home/algorithm) render only when the
 * backend confirms the session; otherwise navigation falls back to /login.
 */
export function App() {
  const navigate = useNavigate()
  const location = useLocation()
  const [user, setUser] = useState<string | null>(null)
  const [checking, setChecking] = useState(true)

  // Live notification area: run events pushed over SignalR.
  const [events, setEvents] = useState<RunEvent[]>([])
  const connectionRef = useRef<Awaited<ReturnType<typeof createRealtimeConnection>> | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .me()
      .then((envelope) => {
        if (cancelled) return
        setUser(envelope.data?.email ?? null)
      })
      .catch(() => {
        if (cancelled) return
        setUser(null)
      })
      .finally(() => {
        if (!cancelled) setChecking(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Open the realtime channel only for authenticated sessions.
  useEffect(() => {
    if (!user) return
    const connection = createRealtimeConnection()
    connectionRef.current = connection
    connection.on('runEvent', (evt: RunEvent) => {
      setEvents((current) => [...current.slice(-9), evt])
    })
    connection
      .start()
      .catch(() => {
        // Realtime is best-effort UI sugar; REST still works without it.
      })
    return () => {
      connectionRef.current = null
      connection.stop().catch(() => {})
    }
  }, [user])

  const logout = useCallback(async () => {
    try {
      await api.logout()
    } finally {
      setUser(null)
      navigate('/login')
    }
  }, [navigate])

  const isProtected = location.pathname === '/home' || location.pathname === '/algorithm'
  const awaitingAuth = checking && isProtected

  return (
    <div>
      <nav aria-label="Primary">
        <span>Stack 35 · SignalR realtime</span>
        {user && (
          <>
            <Link to="/home">Home</Link>
            <Link to="/algorithm">Algorithm</Link>
            <span aria-live="polite">Signed in as {user}</span>
            <button type="button" onClick={logout}>
              Log out
            </button>
          </>
        )}
      </nav>

      <section aria-label="Live notifications" aria-live="polite">
        <h2>Live updates</h2>
        {user && events.length === 0 && <p data-testid="live-empty">Listening for algorithm run events…</p>}
        <ul data-testid="live-events">
          {events.map((evt, i) => (
            <li key={`${evt.occurredAt}-${i}`}>
              {evt.type}: {evt.algorithmId} finished in {evt.executionMs.toFixed(1)} ms (complexity {evt.complexity})
            </li>
          ))}
        </ul>
      </section>

      {awaitingAuth ? <p aria-busy="true">Checking session…</p> : <Outlet context={{ user, setUser }} />}
    </div>
  )
}
