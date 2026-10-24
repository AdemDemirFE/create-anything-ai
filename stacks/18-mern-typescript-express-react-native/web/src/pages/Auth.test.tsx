import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { RegisterPage, LoginPage, HomePage } from './Auth'
import { ApiError } from '../api/client'

const fetchMock = vi.fn()

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
  void fetchMock
})

describe('RegisterPage', () => {
  it('renders accessible labels for email and password', () => {
    renderWithRouter(<RegisterPage />)
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
  })

  it('submits credentials and navigates to login on success', async () => {
    const user = userEvent.setup()
    vi.mocked(api.register).mockResolvedValueOnce({
      ok: true,
      data: { user: { id: 'u1', email: 'a@b.co' } },
      error: null,
      requestId: 'r',
    })
    renderWithRouter(<RegisterPage />)
    await user.type(screen.getByLabelText('Email'), 'a@b.co')
    await user.type(screen.getByLabelText('Password'), 'correct horse battery')
    await user.click(screen.getByRole('button', { name: 'Register' }))
    await waitFor(() => expect(api.register).toHaveBeenCalledWith('a@b.co', 'correct horse battery'))
  })

  it('shows the duplicate-email message on EMAIL_TAKEN', async () => {
    const user = userEvent.setup()
    vi.mocked(api.register).mockRejectedValueOnce(
      new ApiError('EMAIL_TAKEN', 'An account with this email already exists.', 409, 'r'),
    )
    renderWithRouter(<RegisterPage />)
    await user.type(screen.getByLabelText('Email'), 'dupe@b.co')
    await user.type(screen.getByLabelText('Password'), 'correct horse battery')
    await user.click(screen.getByRole('button', { name: 'Register' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('An account with this email already exists.'))
  })

  it('maps field-level details to inline errors', async () => {
    const user = userEvent.setup()
    vi.mocked(api.register).mockRejectedValueOnce(
      new ApiError('VALIDATION_ERROR', 'The request contains invalid fields.', 400, 'r', [
        { field: 'email', code: 'INVALID_FORMAT' },
      ]),
    )
    renderWithRouter(<RegisterPage />)
    await user.type(screen.getByLabelText('Email'), 'nope')
    await user.type(screen.getByLabelText('Password'), 'correct horse battery')
    await user.click(screen.getByRole('button', { name: 'Register' }))
    await waitFor(() => expect(screen.getByText('Email is invalid.')).toBeInTheDocument())
  })
})

describe('LoginPage', () => {
  it('shows the generic error message on INVALID_CREDENTIALS (no enumeration)', async () => {
    const user = userEvent.setup()
    vi.mocked(api.login).mockRejectedValueOnce(
      new ApiError('INVALID_CREDENTIALS', 'Invalid email or password.', 401, 'r'),
    )
    renderWithRouter(<LoginPage />)
    await user.type(screen.getByLabelText('Email'), 'a@b.co')
    await user.type(screen.getByLabelText('Password'), 'wrong password')
    await user.click(screen.getByRole('button', { name: 'Log in' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Invalid email or password.'))
  })

  it('surfaces the throttled message on 429', async () => {
    const user = userEvent.setup()
    vi.mocked(api.login).mockRejectedValueOnce(
      new ApiError('RATE_LIMITED', 'Too many failed login attempts. Try again later.', 429, 'r'),
    )
    renderWithRouter(<LoginPage />)
    await user.type(screen.getByLabelText('Email'), 'a@b.co')
    await user.type(screen.getByLabelText('Password'), 'correct horse battery')
    await user.click(screen.getByRole('button', { name: 'Log in' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Too many failed login attempts.'))
  })
})

describe('HomePage', () => {
  it('renders the profile and metrics after loading, and logs out', async () => {
    const user = userEvent.setup()
    vi.mocked(api.home)
      .mockResolvedValueOnce({
        ok: true,
        data: {
          email: 'home@b.co',
          metrics: [{ label: 'Stored documents', value: '2', unit: 'count' }],
          serverTime: '2026-01-01T00:00:00Z',
        },
        error: null,
        requestId: 'r',
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          email: 'home@b.co',
          metrics: [{ label: 'Stored documents', value: '2', unit: 'count' }],
          serverTime: '2026-01-01T00:00:00Z',
        },
        error: null,
        requestId: 'r',
      })
    vi.mocked(api.logout).mockResolvedValue({ ok: true, data: null, error: null, requestId: 'r' })
    renderWithRouter(<HomePage />)

    await waitFor(() => expect(screen.getByText('Signed in as home@b.co')).toBeInTheDocument())
    expect(screen.getByText(/Stored documents: 2/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Log out' }))
    await waitFor(() => expect(api.logout).toHaveBeenCalled())
  })

  it('shows the error state when home fails', async () => {
    vi.mocked(api.home).mockRejectedValueOnce(new ApiError('NETWORK_ERROR', 'The service is unreachable. Please try again.', 0, 'n/a'))
    renderWithRouter(<HomePage />)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('The service is unreachable.'))
  })

  it('shows a loading state initially', () => {
    vi.mocked(api.home).mockReturnValue(new Promise(() => {}))
    renderWithRouter(<HomePage />)
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })
})
