import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { api, ApiError } from '../api/client'

/**
 * Journeys A/B — Register and Login.
 * Accessible labels, inline validation feedback, generic failure messages.
 * The backend never distinguishes unknown email vs wrong password.
 */
export function AuthPage({ mode }: { mode: 'register' | 'login' }) {
  const navigate = useNavigate()
  const location = useLocation()
  const registered = (location.state as { registered?: boolean } | null)?.registered === true

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    setFieldErrors({})
    setFormError(null)
  }, [mode])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setFieldErrors({})
    setFormError(null)
    try {
      if (mode === 'register') {
        await api.register(email, password)
        navigate('/login', { state: { registered: true } })
      } else {
        const envelope = await api.login(email, password)
        navigate('/home', { state: { email: envelope.data?.email } })
      }
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

  const heading = mode === 'register' ? 'Create your account' : 'Sign in'
  const submitLabel = mode === 'register' ? 'Register' : 'Log in'

  return (
    <main>
      <h1>{heading}</h1>
      {registered && mode === 'login' && <p role="status">Account created. Please sign in.</p>}
      <form onSubmit={onSubmit} noValidate>
        <label htmlFor={`${mode}-email`}>Email</label>
        <input
          id={`${mode}-email`}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={Boolean(fieldErrors.email)}
          aria-describedby={fieldErrors.email ? `${mode}-email-error` : undefined}
          autoComplete="email"
          required
        />
        {fieldErrors.email && (
          <p id={`${mode}-email-error`} role="alert">
            Email is invalid.
          </p>
        )}

        <label htmlFor={`${mode}-password`}>Password</label>
        <input
          id={`${mode}-password`}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={Boolean(fieldErrors.password)}
          aria-describedby={`${mode}-password-hint ${fieldErrors.password ? `${mode}-password-error` : ''}`.trim()}
          autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
          required
        />
        <p id={`${mode}-password-hint`}>
          {mode === 'register' ? 'At least 10 characters with letters and numbers.' : ''}
        </p>
        {fieldErrors.password && (
          <p id={`${mode}-password-error`} role="alert">
            Password is too weak.
          </p>
        )}

        {formError && <p role="alert">{formError}</p>}

        <button type="submit" disabled={submitting}>
          {submitting ? 'Working…' : submitLabel}
        </button>
      </form>
      <p>
        {mode === 'register' ? (
          <Link to="/login">Already have an account? Sign in</Link>
        ) : (
          <Link to="/register">Need an account? Register</Link>
        )}
      </p>
    </main>
  )
}
