import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RegisterPage, LoginPage, HomePage } from './Auth'

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})

function envelope(body: object, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

describe('RegisterPage', () => {
  it('renders accessible labels and submits valid data', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(
      envelope({ success: true, data: { email: 'a@b.co' }, error: null, meta: { timestamp: 't', request_id: 'r' } }, 201),
    )

    render(
      <MemoryRouter>
        <RegisterPage />
      </MemoryRouter>,
    )

    expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument()

    await user.type(screen.getByLabelText(/email/i), 'a@b.co')
    await user.type(screen.getByLabelText(/password/i), 'CorrectHorse1')
    await user.click(screen.getByRole('button', { name: /register/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/register',
        expect.objectContaining({ method: 'POST' }),
      )
    })
  })

  it('shows duplicate-email error from the envelope', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(
      envelope(
        {
          success: false,
          data: null,
          error: { code: 'EMAIL_TAKEN', message: 'An account with this email already exists.' },
          meta: { timestamp: 't', request_id: 'r' },
        },
        409,
      ),
    )

    render(
      <MemoryRouter>
        <RegisterPage />
      </MemoryRouter>,
    )

    await user.type(screen.getByLabelText(/email/i), 'a@b.co')
    await user.type(screen.getByLabelText(/password/i), 'CorrectHorse1')
    await user.click(screen.getByRole('button', { name: /register/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /account with this email already exists/i,
    )
  })
})

describe('LoginPage', () => {
  it('shows generic invalid-credentials error', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(
      envelope(
        {
          success: false,
          data: null,
          error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' },
          meta: { timestamp: 't', request_id: 'r' },
        },
        400,
      ),
    )

    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    )

    await user.type(screen.getByLabelText(/email/i), 'a@b.co')
    await user.type(screen.getByLabelText(/password/i), 'nope')
    await user.click(screen.getByRole('button', { name: /log in/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/invalid email or password/i)
  })
})

describe('HomePage', () => {
  it('shows loading, then profile and metrics', async () => {
    fetchMock.mockResolvedValueOnce(
      envelope({
        success: true,
        data: {
          email: 'a@b.co',
          demo: false,
          metrics: [{ label: 'Active projects', value: '3', unit: 'count' }],
          serverTime: '2026-01-01T00:00:00Z',
        },
        error: null,
        meta: { timestamp: 't', request_id: 'r' },
      }),
    )

    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    )

    expect(screen.getByText(/loading/i)).toBeInTheDocument()
    expect(await screen.findByText(/signed in as a@b\.co/i)).toBeInTheDocument()
    expect(screen.getByText(/active projects/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /log out/i })).toBeInTheDocument()
  })

  it('shows an error state when the API fails', async () => {
    fetchMock.mockResolvedValueOnce(
      envelope(
        { success: false, data: null, error: { code: 'INTERNAL_ERROR', message: 'boom' }, meta: { timestamp: 't', request_id: 'r' } },
        500,
      ),
    )

    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })
})
