'use client'

import { FormEvent, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api, ApiError } from '@/api/client'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.login(email, password)
      router.push('/home')
    } catch (err) {
      if (err instanceof ApiError && err.code === 'RATE_LIMITED') {
        setError('Too many failed attempts. Try again later.')
      } else {
        setError(err instanceof ApiError ? err.message : 'Something went wrong.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <h1>Login</h1>
      <p>Failed attempts are rate-limited per email + IP (429 + Retry-After).</p>
      {error ? (
        <div className="error" role="alert">{error}</div>
      ) : null}
      <form onSubmit={onSubmit}>
        <label className="field">
          <span>Email</span>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
