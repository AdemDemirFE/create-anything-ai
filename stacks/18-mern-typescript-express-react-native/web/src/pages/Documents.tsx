import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../api/client'
import type { DocumentDto } from '../api/client'

/**
 * Document-store screen (the Stack 18 contrast feature): CRUD over the
 * user's own documents, with loading / empty / error states and bounded
 * inputs. All requests go through the shared API client.
 */
export function DocumentsPage() {
  const [state, setState] = useState<
    { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; documents: DocumentDto[]; total: number }
  >({ kind: 'loading' })
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [creating, setCreating] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const LIMIT = 10

  const load = useCallback(
    async (targetPage: number) => {
      setState({ kind: 'loading' })
      try {
        const envelope = await api.listDocuments(targetPage, LIMIT)
        setState({ kind: 'ready', documents: envelope.data?.documents ?? [], total: envelope.data?.pagination.total ?? 0 })
      } catch (err) {
        setState({
          kind: 'error',
          message: err instanceof ApiError && err.status === 401 ? 'Please log in first.' : 'Could not load documents.',
        })
      }
    },
    [],
  )

  useEffect(() => {
    void load(page)
  }, [load, page])

  async function onCreate(e: React.FormEvent) {
    e.preventDefault()
    setCreating(true)
    setFormError(null)
    try {
      await api.createDocument(title, content)
      setTitle('')
      setContent('')
      await load(1)
      setPage(1)
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Unexpected error. Please try again.')
    } finally {
      setCreating(false)
    }
  }

  async function onDelete(id: string) {
    try {
      await api.deleteDocument(id)
      await load(page)
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Unexpected error. Please try again.')
    }
  }

  return (
    <main>
      <h1>Documents</h1>
      <p>
        <a href="/home">Back to home</a>
      </p>

      {state.kind === 'loading' && <p aria-busy="true">Loading documents…</p>}
      {state.kind === 'error' && <p role="alert">{state.message}</p>}

      {state.kind === 'ready' && (
        <>
          <h2>New document</h2>
          <form onSubmit={onCreate} noValidate>
            <label htmlFor="doc-title">Title (max 200 characters)</label>
            <input
              id="doc-title"
              value={title}
              maxLength={200}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
            <label htmlFor="doc-content">Content (max 10,000 characters)</label>
            <textarea
              id="doc-content"
              value={content}
              maxLength={10_000}
              rows={4}
              onChange={(e) => setContent(e.target.value)}
              required
            />
            {formError && <p role="alert">{formError}</p>}
            <button type="submit" disabled={creating || title.length === 0 || content.length === 0}>
              {creating ? 'Creating…' : 'Create document'}
            </button>
          </form>

          <h2>
            Your documents ({state.total})
          </h2>
          {state.documents.length === 0 ? (
            <p>No documents yet. Create your first one above.</p>
          ) : (
            <ul aria-label="document list">
              {state.documents.map((doc) => (
                <li key={doc.id}>
                  <article>
                    <h3>{doc.title}</h3>
                    <p>{doc.content}</p>
                    <p>
                      Updated {new Date(doc.updatedAt).toLocaleString()} ·{' '}
                      <button type="button" onClick={() => onDelete(doc.id)} aria-label={`Delete ${doc.title}`}>
                        Delete
                      </button>
                    </p>
                  </article>
                </li>
              ))}
            </ul>
          )}

          <nav aria-label="pagination">
            <button type="button" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              Previous page
            </button>
            <span> Page {page} </span>
            <button
              type="button"
              disabled={page * LIMIT >= state.total}
              onClick={() => setPage((p) => p + 1)}
            >
              Next page
            </button>
          </nav>
        </>
      )}
    </main>
  )
}
