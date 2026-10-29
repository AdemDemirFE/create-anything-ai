import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, ApiError } from '../api/client'

/** Journey A — Register. Accessible labels + inline validation feedback. */
export function RegisterPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setFieldErrors({})
    setFormError(null)
    try {
      await api.register(email, password)
      navigate('/login', { state: { registered: true } })
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.details?.length) {
          const map: Record<string, string> = {}
          err.details.forEach((d) => (map[d.field] = d.code))
          setFieldErrors(map)
        } else {
          setFormError(err.message)
        }
      } else {
        setFormError('Unexpected error. Please try again.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main>
      <h1>Create your account</h1>
      <form onSubmit={onSubmit} noValidate>
        <label htmlFor="register-email">Email</label>
        <input
          id="register-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={Boolean(fieldErrors.email)}
          aria-describedby={fieldErrors.email ? 'register-email-error' : undefined}
          required
        />
        {fieldErrors.email && (
          <p id="register-email-error" role="alert">
            Email is invalid.
          </p>
        )}

        <label htmlFor="register-password">Password</label>
        <input
          id="register-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={Boolean(fieldErrors.password)}
          aria-describedby="register-password-hint register-password-error"
          required
        />
        <p id="register-password-hint">At least 10 characters with letters and numbers.</p>
        {fieldErrors.password && (
          <p id="register-password-error" role="alert">
            Password is too weak.
          </p>
        )}

        {formError && (
          <p role="alert">{formError}</p>
        )}

        <button type="submit" disabled={submitting}>
          {submitting ? 'Creating account…' : 'Register'}
        </button>
      </form>
      <p>
        Already have an account? <Link to="/login">Log in</Link>
      </p>
    </main>
  )
}

/** Journey B — Login. Loading / error states; session cookie set by backend. */
export function LoginPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [notice] = useState(() => (window.history.state?.state as { registered?: boolean })?.registered)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setFormError(null)
    try {
      await api.login(email, password)
      navigate('/home')
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Unexpected error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main>
      <h1>Log in</h1>
      {notice && <p>Account created. You can log in now.</p>}
      <form onSubmit={onSubmit} noValidate>
        <label htmlFor="login-email">Email</label>
        <input
          id="login-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />
        <label htmlFor="login-password">Password</label>
        <input
          id="login-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
        {formError && (
          <p role="alert">{formError}</p>
        )}
        <button type="submit" disabled={submitting}>
          {submitting ? 'Logging in…' : 'Log in'}
        </button>
      </form>
      <p>
        No account yet? <Link to="/register">Register</Link>
      </p>
    </main>
  )
}

export interface HomeData {
  email: string
  demo: boolean
  metrics: Array<{ label: string; value: string; unit: string }>
  serverTime: string
}

/** Journey C — protected Home with loading / empty / error / demo states. */
export function HomePage() {
  const navigate = useNavigate()
  const [state, setState] = useState<
    { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; data: HomeData }
  >({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false
    api
      .home()
      .then((envelope) => {
        if (!cancelled && envelope.data) setState({ kind: 'ready', data: envelope.data })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        if (err instanceof ApiError && err.status === 401) {
          navigate('/login')
          return
        }
        setState({ kind: 'error', message: err instanceof Error ? err.message : 'Failed to load.' })
      })
    return () => {
      cancelled = true
    }
  }, [navigate])

  async function onLogout() {
    try {
      await api.logout()
    } finally {
      navigate('/login')
    }
  }

  if (state.kind === 'loading') return <main aria-busy="true">Loading…</main>
  if (state.kind === 'error') return <main role="alert">Error: {state.message}</main>

  return (
    <main>
      <h1>Home</h1>
      {state.data.demo && <p>This is demo data — you are not logged in.</p>}
      <p>Signed in as {state.data.email}</p>
      <ul>
        {state.data.metrics.map((m) => (
          <li key={m.label}>
            {m.label}: {m.value} {m.unit}
          </li>
        ))}
      </ul>
      <button type="button" onClick={onLogout}>
        Log out
      </button>
      <p>
        <Link to="/algorithm">Open algorithm workbench</Link>
      </p>
    </main>
  )
}
