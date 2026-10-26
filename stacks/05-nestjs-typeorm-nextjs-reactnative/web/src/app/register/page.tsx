'use client'

import { FormEvent, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api, ApiError } from '@/api/client'

export default function RegisterPage() {
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
      await api.register(email, password)
      router.push('/home')
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <h1>Register</h1>
      <p>An account with a strong password (10+ chars, mixed case + digit).</p>
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
            autoComplete="new-password"
            required
            minLength={10}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button type="submit" disabled={busy}>
          {busy ? 'Creating…' : 'Create account'}
        </button>
      </form>
    </div>
  )
}
