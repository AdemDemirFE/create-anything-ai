import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { login, register } from '../lib/authApi'

/**
 * Journeys A/B — Register and Login (four-screen contract, screens 1–2).
 * Accessible labels, inline validation feedback, generic failure messages.
 * GoTrue itself returns `invalid_credentials` for both unknown users and
 * wrong passwords, so the UI cannot leak account existence.
 */
export function AuthPage({ mode }: { mode: 'register' | 'login' }) {
  const navigate = useNavigate()
  const location = useLocation()
  const registered = (location.state as { registered?: boolean } | null)?.registered === true

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    setFormError(null)
  }, [mode])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setFormError(null)
    try {
      const result = mode === 'register' ? await register(email, password) : await login(email, password)
      if (!result.ok) {
        setFormError(result.error?.message ?? 'Something went wrong. Please try again.')
        return
      }
      if (mode === 'register') {
        navigate('/apps', { state: { justRegistered: true } })
      } else {
        navigate('/apps')
      }
    } catch {
      setFormError('Unexpected error. Please try again.')
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
          autoComplete="email"
          required
        />

        <label htmlFor={`${mode}-password`}>Password</label>
        <input
          id={`${mode}-password`}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
          required
        />
        <p id={`${mode}-password-hint`}>
          {mode === 'register' ? 'At least 8 characters with letters and numbers.' : ''}
        </p>

        {formError && (
          <p role="alert">{formError}</p>
        )}

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
