'use client'

import { FormEvent, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ApiError, api } from '@/api/client'
import { ErrorNote, Shell } from '@/components/shell'

export function AuthForm({ mode }: { mode: 'register' | 'login' }) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const isRegister = mode === 'register'

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setBusy(true)
    try {
      if (isRegister) {
        await api.register(email, password)
        // Auto-login after a successful registration.
        await api.login(email, password)
      } else {
        await api.login(email, password)
      }
      router.push('/home')
    } catch (err) {
      if (err instanceof ApiError) setError(err.message)
      else setError('Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Shell title={isRegister ? 'Create your account' : 'Sign in to continue'}>
      <form onSubmit={onSubmit} className="card" noValidate={false}>
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          required
          maxLength={254}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
        />
        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          required
          minLength={isRegister ? 10 : 1}
          maxLength={128}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={isRegister ? 'new-password' : 'current-password'}
        />
        {error && <ErrorNote message={error} />}
        <button type="submit" disabled={busy}>
          {busy ? 'Working…' : isRegister ? 'Register' : 'Sign in'}
        </button>
        <p className="alt-action">
          {isRegister ? (
            <>
              Already have an account? <Link href="/login">Sign in</Link>
            </>
          ) : (
            <>
              No account yet? <Link href="/register">Register</Link>
            </>
          )}
        </p>
      </form>
    </Shell>
  )
}

export default function AuthScreen({ mode }: { mode: 'register' | 'login' }) {
  return <AuthForm mode={mode} />
}
