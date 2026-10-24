import { useEffect, useState } from 'react'
import { Navigate, useOutletContext } from 'react-router-dom'
import { api, ApiError } from '../api/client'

interface OutletState {
  user: string | null
  setUser: (email: string | null) => void
}

interface HomeData {
  email: string
  demo: boolean
  metrics: Array<{ label: string; value: string; unit: string }>
  serverTime: string
}

/**
 * Journey C — Home (protected). The backend authorizes; this route renders
 * only for confirmed sessions (outlet context from App). Loading, error,
 * and unauthorized states are explicit.
 */
export function HomePage() {
  const { user } = useOutletContext<OutletState>()
  const [home, setHome] = useState<HomeData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    if (!user) {
      // Session resolution still in flight or unauthenticated.
      return
    }
    api
      .home()
      .then((envelope) => {
        if (!cancelled) setHome(envelope.data)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof ApiError ? err.message : 'Unexpected error. Please try again.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [user])

  if (!user && !loading) {
    return <Navigate to="/login" replace />
  }

  return (
    <main>
      <h1>Home</h1>
      {loading && (
        <p aria-busy="true">Loading profile…</p>
      )}
      {error && (
        <p role="alert">{error}</p>
      )}
      {home && (
        <>
          <p>Signed in as {home.email}</p>
          <dl>
            {home.metrics.map((metric) => (
              <div key={metric.label}>
                <dt>{metric.label}</dt>
                <dd>
                  {metric.value} {metric.unit}
                </dd>
              </div>
            ))}
          </dl>
          <p>Server time: {home.serverTime}</p>
          <p>Realtime channel: SignalR hub at /hubs/realtime (same session cookie).</p>
        </>
      )}
    </main>
  )
}
