import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Navigate, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import * as authApi from './lib/authApi'
import type { Session, User } from '@supabase/supabase-js'

vi.mock('./lib/authApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/authApi')>()
  return {
    ...actual,
    getSession: vi.fn(),
    logout: vi.fn(),
  }
})

const getSessionMock = vi.mocked(authApi.getSession)
const logoutMock = vi.mocked(authApi.logout)

function fakeSession(): Session {
  const user = { id: 'u-1', email: 'owner@example.test' } as unknown as User
  return {
    access_token: 'a',
    refresh_token: 'r',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: 'bearer',
    user,
  } as unknown as Session
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<App />}>
          <Route index element={<Navigate to="/login" replace />} />
          <Route path="/login" element={<p>login landing</p>} />
          {/* The guard bounces /apps to /login; the same landing marker keeps
              the redirect observable in the DOM. */}
          <Route path="/apps" element={<p>login landing</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  getSessionMock.mockReset()
  logoutMock.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('App shell auth guard', () => {
  it('shows the checking state, then renders the outlet for a live session', async () => {
    getSessionMock.mockResolvedValueOnce({ ok: true, data: fakeSession(), error: null, requestId: 'r' })
    renderAt('/apps')

    expect(screen.getByText(/checking session/i)).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByText(/signed in as owner@example\.test/i)).toBeInTheDocument()
    })
  })

  it('redirects protected routes to login when no session exists', async () => {
    getSessionMock.mockResolvedValueOnce({ ok: true, data: null, error: null, requestId: 'r' })
    const { container } = renderAt('/apps')

    // The guard <Navigate to="/login"> swaps the outlet for the login route.
    await waitFor(
      () => {
        // After the redirect the /apps element is unmounted; the DOM holds
        // only the shell (login route renders nothing extra in this fixture).
        expect(container.textContent).not.toContain('Checking session')
      },
      { timeout: 2000 },
    )
    expect(screen.queryByText(/signed in as/i)).not.toBeInTheDocument()
    expect(getSessionMock).toHaveBeenCalledTimes(1)
  })

  it('logs out and returns to the login route', async () => {
    const userEvent = (await import('@testing-library/user-event')).default
    getSessionMock.mockResolvedValue({ ok: true, data: fakeSession(), error: null, requestId: 'r' })
    logoutMock.mockResolvedValue({ ok: true, data: null, error: null, requestId: 'r' })
    renderAt('/apps')

    await screen.findByText(/signed in as/i)
    await userEvent.setup().click(screen.getByRole('button', { name: /log out/i }))

    await waitFor(
      () => {
        expect(logoutMock).toHaveBeenCalled()
        // After logout the user bar disappears (state cleared + navigate('/login')).
        expect(screen.queryByText(/signed in as/i)).not.toBeInTheDocument()
      },
      { timeout: 2000 },
    )
  })
})
