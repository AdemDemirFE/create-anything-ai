'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api, ApiError, type HomeData } from '@/api/client'

export default function HomePage() {
  const router = useRouter()
  const [data, setData] = useState<HomeData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(true)

  const load = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const { data: home } = await api.home()
      setData(home)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push('/login')
        return
      }
      setError(err instanceof ApiError ? err.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }, [router])

  useEffect(() => {
    void load()
  }, [load])

  async function onLogout() {
    try {
      await api.logout()
    } finally {
      router.push('/login')
    }
  }

  if (busy && !data) return <div className="card"><p className="muted">Loading…</p></div>

  return (
    <div className="card">
      <h1>Home</h1>
      {error ? <div className="error" role="alert">{error}</div> : null}
      {data ? (
        <>
          <p>
            Signed in as <strong>{data.email}</strong>
          </p>
          <ul className="metrics">
            {data.metrics.map((metric) => (
              <li key={metric.label}>
                <span>{metric.label}</span>
                <span>
                  {metric.value} {metric.unit}
                </span>
              </li>
            ))}
          </ul>
          <p className="muted">Server time: {data.serverTime}</p>
          <button type="button" className="secondary" onClick={onLogout}>
            Log out
          </button>
        </>
      ) : null}
    </div>
  )
}
