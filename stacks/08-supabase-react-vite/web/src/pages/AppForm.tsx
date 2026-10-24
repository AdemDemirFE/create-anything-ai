import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { createApp, getApp, MAX_DESCRIPTION_LENGTH, MAX_NAME_LENGTH, updateApp, validateAppInput } from '../lib/dataApi'
import type { AppStatus } from '../lib/database.types'
import type { AuthUserView } from '../lib/authApi'

interface OutletState {
  user: AuthUserView | null
  setUser: (user: AuthUserView | null) => void
}

const STATUSES: AppStatus[] = ['draft', 'active', 'archived']

/**
 * Journey D — create/edit form (four-screen contract screen 4).
 * Bounded input (mirrors the DB constraints: name ≤ 80 chars, the unique
 * (user_id, name) key) with accessible labels and per-field feedback.
 * `user_id` is never settable from the UI: the insert policy derives
 * ownership from the JWT, and any forged value would fail WITH CHECK.
 */
export function AppFormPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useOutletContext<OutletState>()
  const isEdit = Boolean(id)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState<AppStatus>('draft')
  const [loading, setLoading] = useState(isEdit)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

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
          setName(envelope.data.name)
          setDescription(envelope.data.description)
          setStatus(envelope.data.status)
        } else {
          setFormError(envelope.error?.message ?? 'App not found.')
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

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setFormError(null)
    const inputError = validateAppInput({ name, description })
    if (inputError) {
      setFormError(inputError)
      setSubmitting(false)
      return
    }
    const envelope = isEdit && id
      ? await updateApp(id, { name, description, status })
      : await createApp({ name, description, status })
    if (envelope.ok) {
      navigate(envelope.data ? `/apps/${envelope.data.id}` : '/apps')
    } else {
      setFormError(envelope.error?.message ?? 'Save failed.')
      setSubmitting(false)
    }
  }

  return (
    <main>
      <h1>{isEdit ? 'Edit app' : 'Create app'}</h1>
      <p>
        <Link to="/apps">← Back to your apps</Link>
      </p>

      {loading && <p aria-busy="true">Loading app…</p>}

      {!loading && (
        <form onSubmit={onSubmit} noValidate>
          <label htmlFor="app-name">Name (max {MAX_NAME_LENGTH} characters)</label>
          <input
            id="app-name"
            type="text"
            value={name}
            maxLength={MAX_NAME_LENGTH}
            onChange={(e) => setName(e.target.value)}
            required
          />

          <label htmlFor="app-description">Description (max {MAX_DESCRIPTION_LENGTH.toLocaleString()} characters)</label>
          <textarea
            id="app-description"
            value={description}
            maxLength={MAX_DESCRIPTION_LENGTH}
            onChange={(e) => setDescription(e.target.value.slice(0, MAX_DESCRIPTION_LENGTH))}
            rows={4}
          />
          <p>
            {description.length.toLocaleString()} / {MAX_DESCRIPTION_LENGTH.toLocaleString()} characters
          </p>

          <label htmlFor="app-status">Status</label>
          <select id="app-status" value={status} onChange={(e) => setStatus(e.target.value as AppStatus)}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          {formError && <p role="alert">{formError}</p>}

          <button type="submit" disabled={submitting}>
            {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Create app'}
          </button>
        </form>
      )}
    </main>
  )
}
