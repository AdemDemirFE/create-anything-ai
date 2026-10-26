'use client'

import { FormEvent, useEffect, useState } from 'react'
import { api, ApiError, type AlgorithmInfo, type AlgorithmRunResult } from '@/api/client'

export default function AlgorithmPage() {
  const [catalog, setCatalog] = useState<AlgorithmInfo[]>([])
  const [maxInputLength, setMaxInputLength] = useState<number | null>(null)
  const [algorithmId, setAlgorithmId] = useState('reverse')
  const [input, setInput] = useState('')
  const [result, setResult] = useState<AlgorithmRunResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    api
      .algorithms()
      .then(({ data }) => {
        setCatalog(data.algorithms)
        setMaxInputLength(data.maxInputLength)
      })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : 'Failed to load the catalog.'))
  }, [])

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const { data: run } = await api.runAlgorithm(algorithmId, input)
      setResult(run)
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  const selected = catalog.find((entry) => entry.id === algorithmId)

  return (
    <div className="card">
      <h1>Algorithm workbench</h1>
      <p>
        Fixed catalog — your input is data, never executed code. Oversized input
        is rejected with <code>INPUT_TOO_LARGE</code>
        {maxInputLength !== null ? <> (bound: {maxInputLength.toLocaleString()} characters)</> : null}.
      </p>
      {loadError ? <div className="error" role="alert">{loadError}</div> : null}
      <form onSubmit={onSubmit}>
        <label className="field">
          <span>Algorithm</span>
          <select
            id="algorithmId"
            value={algorithmId}
            onChange={(e) => setAlgorithmId(e.target.value)}
          >
            {catalog.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Input</span>
          <input
            id="input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={algorithmId === 'fizzbuzz' ? 'e.g. 15' : 'any text'}
          />
        </label>
        <button type="submit" disabled={busy || catalog.length === 0}>
          {busy ? 'Running…' : 'Run'}
        </button>
      </form>
      {error ? <div className="error" role="alert" style={{ marginTop: 12 }}>{error}</div> : null}
      {result ? (
        <>
          <h2 style={{ fontSize: 15, margin: '18px 0 6px' }}>Output</h2>
          <pre className="output">{result.output}</pre>
          <p className="muted">
            Measured: {result.executionMs} ms — theoretical: {result.complexity}.{' '}
            {selected?.explanation}
          </p>
        </>
      ) : null}
    </div>
  )
}
