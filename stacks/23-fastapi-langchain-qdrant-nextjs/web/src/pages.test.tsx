import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthForm } from './components/auth-form'
import HomePage from './app/home/page'
import DocumentsPage from './app/documents/page'
import ChatPage from './app/chat/page'
import * as client from './api/client'

// Next.js router mock (app router hooks are used inside the pages).
const push = vi.fn()
const replace = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace, refresh: vi.fn() }),
}))

function envelopeOk(data: unknown) {
  return {
    success: true,
    data,
    error: null,
    meta: { timestamp: '2026-01-01T00:00:00.000Z', request_id: 'r1' },
  } as client.Envelope<unknown>
}

function envelopeErr(code: string, message: string, status: number) {
  return new client.ApiError(code, message, status)
}

beforeEach(() => {
  vi.restoreAllMocks()
  push.mockClear()
  replace.mockClear()
})

afterEach(() => {
  cleanup()
})

describe('AuthForm', () => {
  it('renders accessible labels for register mode', () => {
    render(<AuthForm mode="register" />)
    expect(screen.getByLabelText('Email')).toBeDefined()
    expect(screen.getByLabelText('Password')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Register' })).toBeDefined()
  })

  it('submits register + auto-login and navigates to /home', async () => {
    const user = userEvent.setup()
    vi.spyOn(client.api, 'register').mockResolvedValueOnce(envelopeOk({ email: 'u@b.co' }) as never)
    vi.spyOn(client.api, 'login').mockResolvedValueOnce(envelopeOk({ email: 'u@b.co' }) as never)
    render(<AuthForm mode="register" />)
    await user.type(screen.getByLabelText('Email'), 'u@b.co')
    await user.type(screen.getByLabelText('Password'), 'CorrectHorse1')
    await user.click(screen.getByRole('button', { name: 'Register' }))
    await waitFor(() => expect(push).toHaveBeenCalledWith('/home'))
  })

  it('shows the server message on login failure (429 throttle case)', async () => {
    const user = userEvent.setup()
    vi.spyOn(client.api, 'login').mockRejectedValueOnce(
      envelopeErr('RATE_LIMITED', 'Too many failed login attempts. Try again later.', 429),
    )
    render(<AuthForm mode="login" />)
    await user.type(screen.getByLabelText('Email'), 'u@b.co')
    await user.type(screen.getByLabelText('Password'), 'whatever123')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Too many failed login attempts'))
  })
})

describe('HomePage', () => {
  it('renders profile email and metrics after load', async () => {
    vi.spyOn(client.api, 'me').mockResolvedValueOnce(envelopeOk({ email: 'u@b.co' }) as never)
    vi.spyOn(client.api, 'home').mockResolvedValueOnce(
      envelopeOk({
        email: 'u@b.co',
        metrics: [{ label: 'Documents', value: '2', unit: 'count' }],
        serverTime: '2026-01-01T00:00:00.000Z',
      }) as never,
    )
    render(<HomePage />)
    await waitFor(() => expect(screen.getByTestId('home-email')).toHaveTextContent('u@b.co'))
    expect(screen.getByText('Documents')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Log out' })).toBeDefined()
  })

  it('redirects to /login on 401', async () => {
    vi.spyOn(client.api, 'me').mockRejectedValueOnce(envelopeErr('UNAUTHORIZED', 'Authentication required.', 401))
    render(<HomePage />)
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'))
  })
})

describe('DocumentsPage', () => {
  it('lists uploaded documents with chunk counts', async () => {
    vi.spyOn(client.api, 'me').mockResolvedValueOnce(envelopeOk({ email: 'u@b.co' }) as never)
    vi.spyOn(client.api, 'documents').mockResolvedValueOnce(
      envelopeOk([
        { documentId: 'd1', filename: 'kb.md', sizeBytes: 1024, chunkCount: 3, createdAt: 't' },
      ]) as never,
    )
    render(<DocumentsPage />)
    await waitFor(() => expect(screen.getByText('kb.md')).toBeDefined())
    expect(screen.getByText(/3 chunks/)).toBeDefined()
  })

  it('shows the empty state before any upload', async () => {
    vi.spyOn(client.api, 'me').mockResolvedValueOnce(envelopeOk({ email: 'u@b.co' }) as never)
    vi.spyOn(client.api, 'documents').mockResolvedValueOnce(envelopeOk([]) as never)
    render(<DocumentsPage />)
    await waitFor(() =>
      expect(screen.getByText(/No documents yet/)).toBeDefined(),
    )
  })
})

describe('ChatPage', () => {
  it('shows the thinking state then the answer with sources (polling POST)', async () => {
    const user = userEvent.setup()
    vi.spyOn(client.api, 'me').mockResolvedValueOnce(envelopeOk({ email: 'u@b.co' }) as never)
    let resolveChat: (value: client.Envelope<client.ChatAnswer>) => void = () => {}
    const chatSpy = vi
      .spyOn(client.api, 'chat')
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveChat = resolve
          }),
      )
    render(<ChatPage />)
    await user.type(await screen.findByLabelText('Question'), 'What is Qdrant?')
    await user.click(screen.getByRole('button', { name: 'Ask' }))
    expect(screen.getByRole('status')).toHaveTextContent('Thinking…')
    expect(chatSpy).toHaveBeenCalledWith('What is Qdrant?')
    resolveChat(
      envelopeOk({
        question: 'What is Qdrant?',
        answer: '1. Qdrant is a vector database. [source: kb.md]',
        sources: [{ documentId: 'd1', filename: 'kb.md', chunkIndex: 0, score: 0.42, snippet: 'Qdrant…' }],
        executionMs: 12.5,
      }) as never,
    )
    await waitFor(() =>
      expect(screen.getByText(/Qdrant is a vector database/)).toBeDefined(),
    )
    expect(screen.getByText(/kb\.md · chunk 0/)).toBeDefined()
    expect(screen.getByText(/Answered in 12\.5 ms/)).toBeDefined()
  })

  it('surfaces the NO_DOCUMENTS server message', async () => {
    const user = userEvent.setup()
    vi.spyOn(client.api, 'me').mockResolvedValueOnce(envelopeOk({ email: 'u@b.co' }) as never)
    vi.spyOn(client.api, 'chat').mockRejectedValueOnce(
      envelopeErr('NO_DOCUMENTS', 'Upload a document before chatting.', 400),
    )
    render(<ChatPage />)
    await user.type(await screen.findByLabelText('Question'), 'hello?')
    await user.click(screen.getByRole('button', { name: 'Ask' }))
    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0))
    expect(screen.getAllByRole('alert')[0]).toHaveTextContent('Upload a document before chatting.')
  })
})
