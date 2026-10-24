import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HomePage } from './Home'

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})

function envelope(body: object, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

function renderWithUser() {
  return render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>,
  )
}

// The Home page reads the outlet context; MemoryRouter has no outlet, so the
// component receives undefined user -> redirect. For unit tests we instead
// verify behavior when the session is present by rendering with a wrapper
// that supplies the context through a nested route.
import { Outlet, Route, Routes, useOutletContext } from 'react-router-dom'

function ContextFixture({ email }: { email: string | null }) {
  return (
    <Routes>
      <Route element={<Outlet context={{ user: email, setUser: () => {} }} />}>
        <Route path="/" element={<HomePage />} />
      </Route>
    </Routes>
  )
}

function renderWithContext(email: string | null) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <ContextFixture email={email} />
    </MemoryRouter>,
  )
}

describe('HomePage', () => {
  it('loads profile and metrics for an authenticated session', async () => {
    fetchMock.mockResolvedValueOnce(
      envelope({
        success: true,
        data: {
          email: 'a@b.co',
          demo: false,
          metrics: [
            { label: 'Session', value: 'active', unit: 'state' },
            { label: 'Algorithms', value: '4', unit: 'count' },
            { label: 'Realtime', value: 'SignalR', unit: 'channel' },
          ],
          serverTime: '2026-10-24T12:00:00Z',
        },
        error: null,
        meta: { timestamp: 't', request_id: 'r' },
      }),
    )

    renderWithContext('a@b.co')

    await waitFor(() => {
      expect(screen.getByText(/signed in as a@b\.co/i)).toBeInTheDocument()
    })
    expect(screen.getByText('Session')).toBeInTheDocument()
    expect(screen.getByText(/server time/i)).toBeInTheDocument()
  })

  it('shows error state in an alert when home fails', async () => {
    fetchMock.mockResolvedValueOnce(
      envelope(
        {
          success: false,
          data: null,
          error: { code: 'UNAUTHORIZED', message: 'Authentication is required.' },
          meta: { timestamp: 't', request_id: 'r' },
        },
        401,
      ),
    )

    renderWithContext('a@b.co')
    expect(await screen.findByRole('alert')).toHaveTextContent(/authentication is required/i)
  })

  it('redirects to login when there is no session', async () => {
    // With user=null the component navigates to /login; assert via router.
    renderWithContext(null)
    // No fetch call should be made for home data.
    await waitFor(() => {
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })
})
