import { useEffect, useState } from 'react'
import { Navigate, useOutletContext } from 'react-router-dom'
import { api, ApiError } from '../api/client'

interface OutletState {
  user: string | null
  setUser: (email: string | null) => void
}

interface AlgorithmInfo {
  id: string
  name: string
  complexity: string
  explanation: string
}

interface RunResult {
  algorithmId: string
  output: string
  executionMs: number
  complexity: string
  explanation: string
}

/**
 * Journey D — Algorithm workbench (protected).
 * Security model: the client can only choose a fixed algorithm and supply
 * bounded text. It never sends code for evaluation. Measured duration
 * (executionMs, monotonic clock) is displayed separately from the
 * theoretical Big-O (complexity). Run-completion events also arrive on the
 * SignalR channel and surface in the app-level live notification area.
 */
export function AlgorithmPage() {
  const { user } = useOutletContext<OutletState>()
  const [catalog, setCatalog] = useState<AlgorithmInfo[] | null>(null)
  const [selected, setSelected] = useState<string>('')
  const [input, setInput] = useState('')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<RunResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const MAX_INPUT = 10_000

  useEffect(() => {
    let cancelled = false
    if (!user) return
    api
      .algorithms()
      .then((envelope) => {
        if (cancelled || !envelope.data) return
        setCatalog(envelope.data)
        setSelected((current) => current || envelope.data![0]?.id || '')
      })
      .catch(() => {
        if (!cancelled) setError('Could not load the algorithm catalog.')
      })
    return () => {
      cancelled = true
    }
  }, [user])

  const selectedInfo = catalog?.find((a) => a.id === selected)

  async function onRun(e: React.FormEvent) {
    e.preventDefault()
    setRunning(true)
    setError(null)
    setResult(null)
    try {
      const envelope = await api.runAlgorithm(selected, input)
      if (envelope.data) setResult(envelope.data)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unexpected error. Please try again.')
    } finally {
      setRunning(false)
    }
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  return (
    <main>
      <h1>Algorithm workbench</h1>
      <p>
        Pick a fixed, safe algorithm and bounded input. Your code is never executed — only the
        curated catalog below is available.
      </p>

      {catalog === null && !error && <p aria-busy="true">Loading catalog…</p>}
      {error && <p role="alert">{error}</p>}

      {catalog && (
        <form onSubmit={onRun}>
          <label htmlFor="algorithm-select">Algorithm</label>
          <select
            id="algorithm-select"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            {catalog.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.complexity})
              </option>
            ))}
          </select>
          {selectedInfo && <p>{selectedInfo.explanation}</p>}

          <label htmlFor="algorithm-input">Input (max {MAX_INPUT.toLocaleString()} characters)</label>
          <textarea
            id="algorithm-input"
            value={input}
            maxLength={MAX_INPUT}
            onChange={(e) => {
              // Defense-in-depth: browsers enforce maxLength per keystroke,
              // but programmatic changes (paste in some environments, tests)
              // can exceed it. The backend re-validates the bound regardless.
              setInput(e.target.value.slice(0, MAX_INPUT))
            }}
            rows={4}
            required
          />
          <p>
            {input.length.toLocaleString()} / {MAX_INPUT.toLocaleString()} characters
          </p>

          <button type="submit" disabled={running || !selected || input.length === 0}>
            {running ? 'Running…' : 'Run'}
          </button>
        </form>
      )}

      {result && (
        <section aria-live="polite">
          <h2>Result</h2>
          <pre>{result.output}</pre>
          <p>Measured duration: {result.executionMs.toFixed(1)} ms (monotonic clock, server-side)</p>
          <p>
            Theoretical complexity: {result.complexity} — {result.explanation}
          </p>
        </section>
      )}
    </main>
  )
}
