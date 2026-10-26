/**
 * Web screen tests: the four-screen contract (register / login / home /
 * algorithm) rendered against a MOCKED ApiClient — no server needed. The
 * shared ApiClient contract itself is pinned in ../shared/src.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from '@shared/envelope'

const push = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}))

vi.mock('../api/client', () => ({
  api: {
    register: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    home: vi.fn(),
    algorithms: vi.fn(),
    runAlgorithm: vi.fn(),
  },
  ApiError,
}))

import { api } from '../api/client'
import RegisterPage from '../app/register/page'
import LoginPage from '../app/login/page'
import HomePage from '../app/home/page'
import AlgorithmPage from '../app/algorithm/page'

const mockedApi = vi.mocked(api)

function renderPage(ui: React.ReactElement) {
  return render(ui)
}

beforeEach(() => {
  vi.clearAllMocks()
  push.mockReset()
})

describe('register screen', () => {
  it('renders the form and submits credentials, then routes home on success', async () => {
    mockedApi.register.mockResolvedValue({ data: { id: 1, email: 'person@example.com' }, requestId: 'r-1' })
    const user = userEvent.setup()
    renderPage(<RegisterPage />)

    expect(screen.getByRole('heading', { name: /register/i })).toBeTruthy()
    await user.type(screen.getByLabelText(/email/i), 'person@example.com')
    await user.type(screen.getByLabelText(/password/i), 'Correct-Horse-9x')
    await user.click(screen.getByRole('button', { name: /create account/i }))

    await waitFor(() => expect(mockedApi.register).toHaveBeenCalledWith('person@example.com', 'Correct-Horse-9x'))
    await waitFor(() => expect(push).toHaveBeenCalledWith('/home'))
  })

  it('surfaces the envelope error message on failure', async () => {
    mockedApi.register.mockRejectedValue(new ApiError('EMAIL_TAKEN', 'That email cannot be used.', 409))
    const user = userEvent.setup()
    renderPage(<RegisterPage />)

    await user.type(screen.getByLabelText(/email/i), 'taken@example.com')
    await user.type(screen.getByLabelText(/password/i), 'Correct-Horse-9x')
    await user.click(screen.getByRole('button', { name: /create account/i }))

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('EMAIL_TAKEN'))
    expect(push).not.toHaveBeenCalled()
  })
})

describe('login screen', () => {
  it('submits credentials and routes home on success', async () => {
    mockedApi.login.mockResolvedValue({ data: { id: 1, email: 'person@example.com' }, requestId: 'r-2' })
    const user = userEvent.setup()
    renderPage(<LoginPage />)

    await user.type(screen.getByLabelText(/email/i), 'person@example.com')
    await user.type(screen.getByLabelText(/password/i), 'Correct-Horse-9x')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => expect(mockedApi.login).toHaveBeenCalledWith('person@example.com', 'Correct-Horse-9x'))
    await waitFor(() => expect(push).toHaveBeenCalledWith('/home'))
  })

  it('shows a friendly message for RATE_LIMITED (429)', async () => {
    mockedApi.login.mockRejectedValue(new ApiError('RATE_LIMITED', 'Too many failed attempts. Try again later.', 429))
    const user = userEvent.setup()
    renderPage(<LoginPage />)

    await user.type(screen.getByLabelText(/email/i), 'person@example.com')
    await user.type(screen.getByLabelText(/password/i), 'Wrong-Pass-12')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/too many failed attempts/i))
  })
})

describe('home screen', () => {
  it('loads home data, shows metrics and logs out', async () => {
    mockedApi.home.mockResolvedValue({
      data: {
        email: 'person@example.com',
        metrics: [
          { label: 'Documents stored', value: '3', unit: 'documents' },
          { label: 'Server uptime', value: '12', unit: 's' },
        ],
        serverTime: '2026-10-25T00:00:00.000Z',
      },
      requestId: 'r-3',
    })
    mockedApi.logout.mockResolvedValue({ data: null, requestId: 'r-4' })
    renderPage(<HomePage />)

    await waitFor(() => expect(screen.getByText(/person@example.com/i)).toBeTruthy())
    expect(screen.getByText(/documents stored/i)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /log out/i }))
    await waitFor(() => expect(mockedApi.logout).toHaveBeenCalled())
    await waitFor(() => expect(push).toHaveBeenCalledWith('/login'))
  })

  it('redirects to login on 401 (backend auth is the trust boundary)', async () => {
    mockedApi.home.mockRejectedValue(new ApiError('UNAUTHORIZED', 'Sign in to continue.', 401))
    renderPage(<HomePage />)

    await waitFor(() => expect(push).toHaveBeenCalledWith('/login'))
  })
})

describe('algorithm screen', () => {
  it('loads the catalog and runs an algorithm, showing output + measured duration', async () => {
    mockedApi.algorithms.mockResolvedValue({
      data: {
        algorithms: [
          { id: 'reverse', name: 'Reverse string', complexity: 'O(n)', explanation: 'Walks the input once.' },
        ],
        maxInputLength: 10000,
      },
      requestId: 'r-5',
    })
    mockedApi.runAlgorithm.mockResolvedValue({
      data: { algorithmId: 'reverse', output: 'olleh', executionMs: 0.4, complexity: 'O(n)', explanation: 'Walks the input once.' },
      requestId: 'r-6',
    })
    const user = userEvent.setup()
    renderPage(<AlgorithmPage />)

    await waitFor(() => expect(screen.getByLabelText(/algorithm/i)).toBeTruthy())
    await user.type(screen.getByLabelText(/input/i), 'hello')
    await user.click(screen.getByRole('button', { name: /run/i }))

    await waitFor(() => expect(mockedApi.runAlgorithm).toHaveBeenCalledWith('reverse', 'hello'))
    await waitFor(() => expect(screen.getByText('olleh')).toBeTruthy())
    expect(screen.getByText(/measured:/i).textContent).toContain('0.4')
  })

  it('surfaces INPUT_TOO_LARGE errors from the engine bound', async () => {
    mockedApi.algorithms.mockResolvedValue({
      data: {
        algorithms: [
          { id: 'reverse', name: 'Reverse string', complexity: 'O(n)', explanation: 'Walks the input once.' },
        ],
        maxInputLength: 10000,
      },
      requestId: 'r-7',
    })
    mockedApi.runAlgorithm.mockRejectedValue(new ApiError('INPUT_TOO_LARGE', 'Input exceeds the maximum of 10000 characters.', 400))
    const user = userEvent.setup()
    renderPage(<AlgorithmPage />)

    await waitFor(() => expect(screen.getByLabelText(/input/i)).toBeTruthy())
    await user.type(screen.getByLabelText(/input/i), 'some oversized text')
    await user.click(screen.getByRole('button', { name: /run/i }))

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('INPUT_TOO_LARGE'))
  })
})
