import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AlgorithmPage } from './Algorithm'
import { DocumentsPage } from './Documents'
import { ApiError } from '../api/client'

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>()
  return {
    ...actual,
    api: {
      register: vi.fn(),
      login: vi.fn(),
      logout: vi.fn(),
      home: vi.fn(),
      algorithms: vi.fn(),
      runAlgorithm: vi.fn(),
      listDocuments: vi.fn(),
      getDocument: vi.fn(),
      createDocument: vi.fn(),
      updateDocument: vi.fn(),
      deleteDocument: vi.fn(),
    },
  }
})

import { api } from '../api/client'

function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('AlgorithmPage', () => {
  const catalog = [
    { id: 'fizzbuzz', name: 'FizzBuzz', complexity: 'O(n)', explanation: 'One line per number.' },
    { id: 'reverse', name: 'Reverse text', complexity: 'O(n)', explanation: 'Single reversed copy.' },
  ]

  it('loads the catalog and shows the selected algorithm explanation', async () => {
    vi.mocked(api.algorithms).mockResolvedValueOnce({ ok: true, data: catalog, error: null, requestId: 'r' })
    renderWithRouter(<AlgorithmPage />)
    await waitFor(() => expect(screen.getByLabelText('Algorithm')).toBeInTheDocument())
    expect(screen.getByText('One line per number.')).toBeInTheDocument()
  })

  it('runs an algorithm and displays measured duration separately from Big-O', async () => {
    const user = userEvent.setup()
    vi.mocked(api.algorithms).mockResolvedValueOnce({ ok: true, data: catalog, error: null, requestId: 'r' })
    vi.mocked(api.runAlgorithm).mockResolvedValueOnce({
      ok: true,
      data: { algorithmId: 'reverse', output: 'kcats', executionMs: 0.42, complexity: 'O(n)', explanation: 'Single reversed copy.' },
      error: null,
      requestId: 'r',
    })
    renderWithRouter(<AlgorithmPage />)
    await waitFor(() => expect(screen.getByLabelText('Algorithm')).toBeInTheDocument())
    await user.type(screen.getByLabelText(/Input/), 'stack')
    await user.click(screen.getByRole('button', { name: 'Run' }))
    await waitFor(() => expect(screen.getByText('kcats')).toBeInTheDocument())
    expect(screen.getByText(/Measured duration: 0\.4 ms/)).toBeInTheDocument()
    expect(screen.getByText(/Theoretical complexity: O\(n\)/)).toBeInTheDocument()
  })

  it('shows INPUT_TOO_LARGE errors from the server', async () => {
    const user = userEvent.setup()
    vi.mocked(api.algorithms).mockResolvedValueOnce({ ok: true, data: catalog, error: null, requestId: 'r' })
    vi.mocked(api.runAlgorithm).mockRejectedValueOnce(
      new ApiError('INPUT_TOO_LARGE', 'Input exceeds the maximum length of 10000 characters.', 400, 'r'),
    )
    renderWithRouter(<AlgorithmPage />)
    await waitFor(() => expect(screen.getByLabelText('Algorithm')).toBeInTheDocument())
    await user.type(screen.getByLabelText(/Input/), 'x')
    await user.click(screen.getByRole('button', { name: 'Run' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Input exceeds the maximum length'))
  })

  it('prompts login on 401', async () => {
    vi.mocked(api.algorithms).mockRejectedValueOnce(new ApiError('UNAUTHORIZED', 'Authentication required.', 401, 'r'))
    renderWithRouter(<AlgorithmPage />)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Please log in first.'))
  })
})

describe('DocumentsPage', () => {
  const documents = [
    { id: 'd1', title: 'First note', content: 'hello', tags: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
    { id: 'd2', title: 'Second note', content: 'world', tags: ['tag'], createdAt: '2026-01-02T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z' },
  ]

  it('lists documents with pagination info', async () => {
    vi.mocked(api.listDocuments).mockResolvedValueOnce({
      ok: true,
      data: { documents, pagination: { page: 1, limit: 10, total: 2, pages: 1 } },
      error: null,
      requestId: 'r',
    })
    renderWithRouter(<DocumentsPage />)
    await waitFor(() => expect(screen.getByText('First note')).toBeInTheDocument())
    expect(screen.getByText('Second note')).toBeInTheDocument()
    expect(screen.getByText(/Your documents \(2\)/)).toBeInTheDocument()
  })

  it('shows the empty state', async () => {
    vi.mocked(api.listDocuments).mockResolvedValueOnce({
      ok: true,
      data: { documents: [], pagination: { page: 1, limit: 10, total: 0, pages: 1 } },
      error: null,
      requestId: 'r',
    })
    renderWithRouter(<DocumentsPage />)
    await waitFor(() => expect(screen.getByText('No documents yet. Create your first one above.')).toBeInTheDocument())
  })

  it('creates a document and reloads the list', async () => {
    const user = userEvent.setup()
    vi.mocked(api.listDocuments)
      .mockResolvedValueOnce({
        ok: true,
        data: { documents: [], pagination: { page: 1, limit: 10, total: 0, pages: 1 } },
        error: null,
        requestId: 'r',
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { documents, pagination: { page: 1, limit: 10, total: 2, pages: 1 } },
        error: null,
        requestId: 'r',
      })
    vi.mocked(api.createDocument).mockResolvedValueOnce({
      ok: true,
      data: { document: documents[0] },
      error: null,
      requestId: 'r',
    })
    renderWithRouter(<DocumentsPage />)
    await waitFor(() => expect(screen.getByLabelText('Title (max 200 characters)')).toBeInTheDocument())
    await user.type(screen.getByLabelText('Title (max 200 characters)'), 'First note')
    await user.type(screen.getByLabelText('Content (max 10,000 characters)'), 'hello')
    await user.click(screen.getByRole('button', { name: 'Create document' }))
    await waitFor(() => expect(api.createDocument).toHaveBeenCalledWith('First note', 'hello'))
    await waitFor(() => expect(screen.getByText(/Your documents \(2\)/)).toBeInTheDocument())
  })

  it('deletes a document and reloads', async () => {
    const user = userEvent.setup()
    vi.mocked(api.listDocuments)
      .mockResolvedValueOnce({
        ok: true,
        data: { documents, pagination: { page: 1, limit: 10, total: 2, pages: 1 } },
        error: null,
        requestId: 'r',
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { documents: [documents[1]], pagination: { page: 1, limit: 10, total: 1, pages: 1 } },
        error: null,
        requestId: 'r',
      })
    vi.mocked(api.deleteDocument).mockResolvedValueOnce({ ok: true, data: { deletedId: 'd1' }, error: null, requestId: 'r' })
    renderWithRouter(<DocumentsPage />)
    await waitFor(() => expect(screen.getByText('First note')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Delete First note' }))
    await waitFor(() => expect(api.deleteDocument).toHaveBeenCalledWith('d1'))
    await waitFor(() => expect(screen.queryByText('First note')).not.toBeInTheDocument())
  })

  it('shows the error state on failure', async () => {
    vi.mocked(api.listDocuments).mockRejectedValueOnce(new ApiError('NETWORK_ERROR', 'The service is unreachable. Please try again.', 0, 'n/a'))
    renderWithRouter(<DocumentsPage />)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not load documents.'))
  })

  it('prompts login on 401', async () => {
    vi.mocked(api.listDocuments).mockRejectedValueOnce(new ApiError('UNAUTHORIZED', 'Authentication required.', 401, 'r'))
    renderWithRouter(<DocumentsPage />)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Please log in first.'))
  })
})
