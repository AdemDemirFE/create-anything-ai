import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { deleteApp, getApp } from '../lib/dataApi'
import type { AppRow } from '../lib/database.types'
import type { AuthUserView } from '../lib/authApi'

interface OutletState {
  user: AuthUserView | null
  setUser: (user: AuthUserView | null) => void
}

/**
 * Journey C detail — single app view (four-screen contract screen 3b).
 * A foreign id resolves to NOT_FOUND through RLS (the row is invisible), so
 * this screen never reveals other users' data.
 */
export function DetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useOutletContext<OutletState>()
  const [app, setApp] = useState<AppRow | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!user || !id) {
      setLoading(false)
      return
    }
    getApp(id)
      .then((envelope) => {
        if (cancelled) return
        if (envelope.ok && envelope.data) {
          setApp(envelope.data)
        } else {
          setError(envelope.error?.message ?? 'App not found.')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [user, id])

  if (!user && !loading) {
    return <Navigate to="/login" replace />
  }

  async function onDelete() {
    if (!id || deleting) return
    setDeleting(true)
    const envelope = await deleteApp(id)
    if (envelope.ok) {
      navigate('/apps')
    } else {
      setError(envelope.error?.message ?? 'Delete failed.')
      setDeleting(false)
    }
  }

  return (
    <main>
      <h1>App detail</h1>
      <p>
        <Link to="/apps">← Back to your apps</Link>
      </p>

      {loading && <p aria-busy="true">Loading app…</p>}
      {error && <p role="alert">{error}</p>}

      {app && (
        <>
          <dl>
            <dt>Name</dt>
            <dd>{app.name}</dd>
            <dt>Description</dt>
            <dd>{app.description || <em>(no description)</em>}</dd>
            <dt>Status</dt>
            <dd>{app.status}</dd>
            <dt>Created</dt>
            <dd>{new Date(app.created_at).toLocaleString()}</dd>
            <dt>Updated</dt>
            <dd>{new Date(app.updated_at).toLocaleString()}</dd>
          </dl>
          <p>
            <Link to={`/apps/${app.id}/edit`}>Edit this app</Link>
          </p>
          <p>
            <button type="button" onClick={onDelete} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Delete app'}
            </button>
          </p>
        </>
      )}
    </main>
  )
}
