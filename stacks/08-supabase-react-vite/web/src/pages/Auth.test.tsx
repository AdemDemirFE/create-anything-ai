import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthPage } from './Auth'
import * as authApi from '../lib/authApi'
import { ErrorCodes } from '../lib/envelope'
import type { AuthResult } from '../lib/authApi'
import type { Envelope } from '../lib/envelope'
import type { Session, User } from '@supabase/supabase-js'

vi.mock('../lib/authApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/authApi')>()
  return {
    ...actual,
    register: vi.fn(),
    login: vi.fn(),
  }
})

const registerMock = vi.mocked(authApi.register)
const loginMock = vi.mocked(authApi.login)

function fakeAuthResult(email: string): Envelope<AuthResult> {
  const user = { id: 'u-1', email } as unknown as User
  const session = {
    access_token: 'a',
    refresh_token: 'r',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: 'bearer',
    user,
  } as unknown as Session
  return { ok: true, data: { user, session }, error: null, requestId: 'req-test' }
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/register" element={<AuthPage mode="register" />} />
        <Route path="/login" element={<AuthPage mode="login" />} />
        <Route path="/apps" element={<p>apps landing</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  registerMock.mockReset()
  loginMock.mockReset()
})

describe('RegisterPage', () => {
  it('has accessible labels and navigates to the app list after success', async () => {
    const user = userEvent.setup()
    registerMock.mockResolvedValueOnce(fakeAuthResult('new.user@example.test'))

    renderAt('/register')

    await user.type(screen.getByLabelText(/email/i), 'new.user@example.test')
    await user.type(screen.getByLabelText(/password/i), 'CorrectHorse1')
    await user.click(screen.getByRole('button', { name: /register/i }))

    await waitFor(() => {
      expect(registerMock).toHaveBeenCalledWith('new.user@example.test', 'CorrectHorse1')
      expect(screen.getByText('apps landing')).toBeInTheDocument()
    })
  })

  it('surfaces the duplicate-email error in an alert region', async () => {
    const user = userEvent.setup()
    registerMock.mockResolvedValueOnce({
      ok: false,
      data: null,
      error: { code: ErrorCodes.EmailTaken, message: 'An account with this email already exists.', status: 422 },
      requestId: 'req-1',
    })

    renderAt('/register')
    await user.type(screen.getByLabelText(/email/i), 'taken.user@example.test')
    await user.type(screen.getByLabelText(/password/i), 'CorrectHorse1')
    await user.click(screen.getByRole('button', { name: /register/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/already exists/i)
  })

  it('surfaces the weak-password error in an alert region', async () => {
    const user = userEvent.setup()
    registerMock.mockResolvedValueOnce({
      ok: false,
      data: null,
      error: {
        code: ErrorCodes.WeakPassword,
        message: 'This password is too weak. Use 8+ characters with letters and numbers.',
        status: 422,
      },
      requestId: 'req-2',
    })

    renderAt('/register')
    await user.type(screen.getByLabelText(/email/i), 'weak.user@example.test')
    await user.type(screen.getByLabelText(/password/i), 'CorrectHorse1')
    await user.click(screen.getByRole('button', { name: /register/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/too weak/i)
  })
})

describe('LoginPage', () => {
  it('shows the generic failure message — unknown user and wrong password are identical', async () => {
    const user = userEvent.setup()
    loginMock.mockResolvedValue({
      ok: false,
      data: null,
      error: { code: ErrorCodes.InvalidCredentials, message: 'Invalid email or password.', status: 400 },
      requestId: 'req-3',
    })

    renderAt('/login')
    await user.type(screen.getByLabelText(/email/i), 'ghost.user@example.test')
    await user.type(screen.getByLabelText(/password/i), 'IncorrectHorse1')
    await user.click(screen.getByRole('button', { name: /log in/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/invalid email or password/i)

    await user.clear(screen.getByLabelText(/email/i))
    await user.clear(screen.getByLabelText(/password/i))
    await user.type(screen.getByLabelText(/email/i), 'known.user@example.test')
    await user.type(screen.getByLabelText(/password/i), 'IncorrectHorse1')
    await user.click(screen.getByRole('button', { name: /log in/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/invalid email or password/i)
  })

  it('navigates to the app list on success', async () => {
    const user = userEvent.setup()
    loginMock.mockResolvedValueOnce(fakeAuthResult('known.user@example.test'))

    renderAt('/login')
    await user.type(screen.getByLabelText(/email/i), 'known.user@example.test')
    await user.type(screen.getByLabelText(/password/i), 'CorrectHorse1')
    await user.click(screen.getByRole('button', { name: /log in/i }))

    await waitFor(() => {
      expect(screen.getByText('apps landing')).toBeInTheDocument()
    })
  })
})
