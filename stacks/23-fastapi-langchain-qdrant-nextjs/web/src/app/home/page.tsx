'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ApiError, api, type HomeData } from '@/api/client'
import { ErrorNote, Loading, Shell, useRequireAuth } from '@/components/shell'

export default function HomePage() {
  const router = useRouter()
  const { loading, unauthorized } = useRequireAuth()
  const [home, setHome] = useState<HomeData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (unauthorized) router.replace('/login')
  }, [unauthorized, router])

  useEffect(() => {
    let cancelled = false
    api
      .home()
      .then((res) => {
        if (!cancelled) setHome(res.data)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          if (err instanceof ApiError && err.status === 401) router.replace('/login')
          else setError('Could not load your workspace.')
        }
      })
    return () => {
      cancelled = true
    }
  }, [router])

  async function logout() {
    try {
      await api.logout()
    } finally {
      router.replace('/login')
    }
  }

  if (loading) return <Loading label="Loading…" />

  return (
    <Shell title="Your workspace at a glance">
      <section className="card" aria-label="Profile">
        <h2>Profile</h2>
        <p data-testid="home-email">{home?.email ?? '—'}</p>
        <p className="muted">Server time: {home?.serverTime ?? '—'}</p>
        <button type="button" onClick={logout}>
          Log out
        </button>
      </section>
      <section className="card" aria-label="Sample metrics">
        <h2>Sample metrics</h2>
        <ul className="metrics">
          {(home?.metrics ?? []).map((metric) => (
            <li key={metric.label}>
              <span>{metric.label}</span>
              <strong>
                {metric.value} {metric.unit}
              </strong>
            </li>
          ))}
        </ul>
      </section>
      {error && <ErrorNote message={error} />}
      <nav className="actions">
        <a href="/documents">Documents →</a>
        <a href="/chat">Chat →</a>
      </nav>
    </Shell>
  )
}
