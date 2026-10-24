'use client'

import { FormEvent, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ApiError, api, type DocumentInfo } from '@/api/client'
import { ErrorNote, Loading, Shell, useRequireAuth } from '@/components/shell'

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 // mirrors backend MAX_DOCUMENT_BYTES

export default function DocumentsPage() {
  const router = useRouter()
  const { loading, unauthorized } = useRequireAuth()
  const [docs, setDocs] = useState<DocumentInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (unauthorized) router.replace('/login')
  }, [unauthorized, router])

  async function refresh() {
    try {
      const res = await api.documents()
      setDocs(res.data)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) router.replace('/login')
      else setError('Could not load documents.')
    }
  }

  useEffect(() => {
    if (!loading) void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading])

  async function onUpload(event: FormEvent) {
    event.preventDefault()
    const file = fileInput.current?.files?.[0]
    if (!file) {
      setError('Choose a .txt or .md file first.')
      return
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError('Files are limited to 2 MiB.')
      return
    }
    setError(null)
    setBusy(true)
    try {
      await api.uploadDocument(file)
      if (fileInput.current) fileInput.current.value = ''
      await refresh()
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) router.replace('/login')
      else if (err instanceof ApiError) setError(err.message)
      else setError('Upload failed.')
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <Loading label="Loading…" />

  return (
    <Shell title="Upload knowledge for your RAG chat">
      <form onSubmit={onUpload} className="card">
        <label htmlFor="file">Document (.txt / .md, max 2 MiB)</label>
        <input id="file" ref={fileInput} type="file" accept=".txt,.md" />
        <button type="submit" disabled={busy}>
          {busy ? 'Uploading…' : 'Upload'}
        </button>
        {error && <ErrorNote message={error} />}
      </form>
      <section className="card" aria-label="Uploaded documents">
        <h2>Documents</h2>
        {docs === null ? (
          <Loading label="Loading documents…" />
        ) : docs.length === 0 ? (
          <p className="muted">No documents yet. Upload your first knowledge file above.</p>
        ) : (
          <ul className="doc-list">
            {docs.map((doc) => (
              <li key={doc.documentId}>
                <span>{doc.filename}</span>
                <span className="muted">
                  {(doc.sizeBytes / 1024).toFixed(1)} KiB · {doc.chunkCount} chunks
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <nav className="actions">
        <a href="/chat">Chat →</a>
      </nav>
    </Shell>
  )
}
