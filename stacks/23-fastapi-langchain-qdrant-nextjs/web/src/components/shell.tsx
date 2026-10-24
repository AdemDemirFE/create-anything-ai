'use client'

import { useEffect, useState } from 'react'
import { ApiError, api, type AuthUser } from '@/api/client'

/**
 * Shared auth guard + shell for the four-screen journey.
 * Client routing guards the pages; the backend enforces the session on
 * every protected endpoint (401 -> redirect to /login).
 */

export function useRequireAuth(): { user: AuthUser | null; loading: boolean; unauthorized: boolean } {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [unauthorized, setUnauthorized] = useState(false)

  useEffect(() => {
    let cancelled = false
    api
      .me()
      .then((res) => {
        if (!cancelled) setUser(res.data)
      })
      .catch((err: unknown) => {
        if (!cancelled && err instanceof ApiError && err.status === 401) setUnauthorized(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return { user, loading, unauthorized }
}

export function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="shell">
      <header className="shell-header">
        <h1>Stack 23 · RAG Workbench</h1>
        <p className="shell-subtitle">{title}</p>
      </header>
      {children}
    </main>
  )
}

export function Loading({ label }: { label: string }) {
  return (
    <p role="status" aria-busy="true" className="status">
      {label}
    </p>
  )
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <p role="alert" className="error-note">
      {message}
    </p>
  )
}
