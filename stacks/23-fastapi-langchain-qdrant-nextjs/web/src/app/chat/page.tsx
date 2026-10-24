'use client'

import { FormEvent, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ApiError, api, type ChatAnswer } from '@/api/client'
import { ErrorNote, Loading, Shell, useRequireAuth } from '@/components/shell'

interface Turn {
  question: string
  answer: string | null
  sources?: ChatAnswer['sources']
  executionMs?: number
  error?: string
}

/**
 * Chat screen. Polling model only: every question is a single JSON POST
 * (`api.chat`); there is no EventSource, no fetch-stream, no SSE (QA
 * lesson M9). A "thinking…" row is plain UI state while the POST is in
 * flight - not a stream consumer.
 */
export default function ChatPage() {
  const router = useRouter()
  const { loading, unauthorized } = useRequireAuth()
  const [turns, setTurns] = useState<Turn[]>([])
  const [question, setQuestion] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (unauthorized) router.replace('/login')
  }, [unauthorized, router])

  useEffect(() => {
    // jsdom does not implement scrollTo; guard keeps tests and odd embedders
    // safe while real browsers get the auto-scroll behavior.
    const log = logRef.current
    if (log && typeof log.scrollTo === 'function') {
      log.scrollTo({ top: log.scrollHeight })
    }
  }, [turns])

  async function onAsk(event: FormEvent) {
    event.preventDefault()
    const trimmed = question.trim()
    if (!trimmed || pending) return
    setQuestion('')
    setError(null)
    setPending(true)
    setTurns((prev) => [...prev, { question: trimmed, answer: null }])
    try {
      const res = await api.chat(trimmed)
      const data = res.data
      setTurns((prev) =>
        prev.map((turn, index) =>
          index === prev.length - 1
            ? { ...turn, answer: data?.answer ?? '', sources: data?.sources, executionMs: data?.executionMs }
            : turn,
        ),
      )
    } catch (err) {
      const message =
        err instanceof ApiError && err.status === 401
          ? (router.replace('/login'), 'Session expired.')
          : err instanceof ApiError
            ? err.message
            : 'Chat request failed.'
      setTurns((prev) =>
        prev.map((turn, index) => (index === prev.length - 1 ? { ...turn, answer: '', error: message } : turn)),
      )
      if (!(err instanceof ApiError && err.status === 401)) setError(message)
    } finally {
      setPending(false)
    }
  }

  if (loading) return <Loading label="Loading…" />

  return (
    <Shell title="Ask questions across your uploaded documents">
      <div className="card chat-log" ref={logRef} aria-live="polite" aria-label="Conversation log">
        {turns.length === 0 && <p className="muted">Ask anything about your documents.</p>}
        {turns.map((turn, index) => (
          <article key={index} className="turn">
            <p className="question">You: {turn.question}</p>
            {turn.answer === null && (
              <p role="status" aria-busy="true" className="muted">
                Thinking…
              </p>
            )}
            {turn.answer !== null && turn.answer !== '' && (
              <>
                <p className="answer">{turn.answer}</p>
                {turn.sources && turn.sources.length > 0 && (
                  <ul className="sources">
                    {turn.sources.map((source, sourceIndex) => (
                      <li key={sourceIndex} className="muted">
                        {source.filename} · chunk {source.chunkIndex} · score {source.score.toFixed(3)}
                      </li>
                    ))}
                  </ul>
                )}
                {typeof turn.executionMs === 'number' && (
                  <p className="muted measured">Answered in {turn.executionMs.toFixed(1)} ms (measured)</p>
                )}
              </>
            )}
            {turn.error && <ErrorNote message={turn.error} />}
          </article>
        ))}
      </div>
      <form onSubmit={onAsk} className="card chat-form">
        <label htmlFor="question">Question</label>
        <input
          id="question"
          value={question}
          maxLength={4000}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="e.g. What is Qdrant?"
          autoComplete="off"
        />
        <button type="submit" disabled={pending}>
          {pending ? 'Asking…' : 'Ask'}
        </button>
        {error && <ErrorNote message={error} />}
      </form>
      <nav className="actions">
        <a href="/documents">← Documents</a>
      </nav>
    </Shell>
  )
}
