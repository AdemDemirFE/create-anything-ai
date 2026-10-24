import { useEffect, useState } from 'react'
import { Link, Navigate, useOutletContext } from 'react-router-dom'
import { listApps } from '../lib/dataApi'
import type { AppRow } from '../lib/database.types'
import type { AuthUserView } from '../lib/authApi'

interface OutletState {
  user: AuthUserView | null
  setUser: (user: AuthUserView | null) => void
}

/**
 * Journey C — Apps list (protected, four-screen contract screen 3).
 * RLS guarantees the result only ever contains the signed-in user's rows;
 * loading, empty, error, and unauthorized states are explicit.
 */
export function ListPage() {
  const { user } = useOutletContext<OutletState>()
  const [apps, setApps] = useState<AppRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    if (!user) {
      setLoading(false)
      return
    }
    listApps()
      .then((envelope) => {
        if (cancelled) return
        if (envelope.ok) {
          setApps(envelope.data ?? [])
        } else {
          setError(envelope.error?.message ?? 'Could not load your apps.')
        }
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
      <h1>Your apps</h1>
      {loading && <p aria-busy="true">Loading apps…</p>}
      {error && <p role="alert">{error}</p>}

      {apps !== null && apps.length === 0 && (
        <p data-testid="apps-empty">
          No apps yet. <Link to="/apps/new">Create your first app</Link>.
        </p>
      )}

      {apps !== null && apps.length > 0 && (
        <>
          <p>
            <Link to="/apps/new">Create a new app</Link>
          </p>
          <ul data-testid="apps-list">
            {apps.map((app) => (
              <li key={app.id}>
                <Link to={`/apps/${app.id}`}>{app.name}</Link>{' '}
                <span>
                  status: {app.status} · updated {new Date(app.updated_at).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  )
}
