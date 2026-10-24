import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthPage } from './Auth'

const fetchMock = vi.fn()
const navigateMock = vi.fn()

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return {
    ...actual,
    useNavigate: () => navigateMock,
  }
})

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  navigateMock.mockReset()
})

function envelope(body: object, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/register" element={<AuthPage mode="register" />} />
        <Route path="/login" element={<AuthPage mode="login" />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('RegisterPage', () => {
  it('has accessible labels and navigates to login after successful register', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(
      envelope({
        success: true,
        data: { email: 'new@user.co' },
        error: null,
        meta: { timestamp: 't', request_id: 'r' },
      }, 201),
    )

    renderAt('/register')

    await user.type(screen.getByLabelText(/email/i), 'new@user.co')
    await user.type(screen.getByLabelText(/password/i), 'CorrectHorse1')
    await user.click(screen.getByRole('button', { name: /register/i }))

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/login', expect.objectContaining({ state: { registered: true } }))
    })
  })

  it('surfaces duplicate email error in an alert region', async () => {
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

    renderAt('/register')
    await user.type(screen.getByLabelText(/email/i), 'taken@user.co')
    await user.type(screen.getByLabelText(/password/i), 'CorrectHorse1')
    await user.click(screen.getByRole('button', { name: /register/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/already exists/i)
  })
})

describe('LoginPage', () => {
  it('shows the generic failure message without enumeration', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(
      envelope(
        {
          success: false,
          data: null,
          error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' },
          meta: { timestamp: 't', request_id: 'r' },
        },
        401,
      ),
    )

    renderAt('/login')
    await user.type(screen.getByLabelText(/email/i), 'ghost@user.co')
    await user.type(screen.getByLabelText(/password/i), 'IncorrectHorse1')
    await user.click(screen.getByRole('button', { name: /log in/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/invalid email or password/i)
  })

  it('surfaces the 429 rate-limit message in an alert', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(
      envelope(
        {
          success: false,
          data: null,
          error: { code: 'RATE_LIMITED', message: 'Too many failed attempts. Please wait and try again.' },
          meta: { timestamp: 't', request_id: 'r' },
        },
        429,
      ),
    )

    renderAt('/login')
    await user.type(screen.getByLabelText(/email/i), 'ghost@user.co')
    await user.type(screen.getByLabelText(/password/i), 'IncorrectHorse1')
    await user.click(screen.getByRole('button', { name: /log in/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/too many failed attempts/i)
  })
})
