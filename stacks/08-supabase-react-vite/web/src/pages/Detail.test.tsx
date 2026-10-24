import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DetailPage } from './Detail'
import * as dataApi from '../lib/dataApi'
import type { AppRow } from '../lib/database.types'
import { ErrorCodes } from '../lib/envelope'

vi.mock('../lib/dataApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/dataApi')>()
  return {
    ...actual,
    getApp: vi.fn(),
    deleteApp: vi.fn(),
  }
})

const getAppMock = vi.mocked(dataApi.getApp)
const deleteAppMock = vi.mocked(dataApi.deleteApp)

const OWNED: AppRow = {
  id: 'app-1',
  user_id: 'u-1',
  name: 'Alpha',
  description: 'First demo app',
  status: 'active',
  created_at: '2026-01-01T12:00:00Z',
  updated_at: '2026-01-02T12:00:00Z',
}

function renderAt(path: string) {
  function Fixture() {
    return (
      <Routes>
        <Route
          element={<Outlet context={{ user: { id: 'u-1', email: 'owner@example.test' }, setUser: () => {} }} />}
        >
          <Route path="/apps/:id" element={<DetailPage />} />
        </Route>
        <Route path="/login" element={<p>login landing</p>} />
        <Route path="/apps" element={<p>list landing</p>} />
        <Route path="/apps/:id/edit" element={<p>edit landing</p>} />
      </Routes>
    )
  }
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Fixture />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  getAppMock.mockReset()
  deleteAppMock.mockReset()
})

describe('DetailPage', () => {
  it('renders the owned app with all fields', async () => {
    getAppMock.mockResolvedValueOnce({ ok: true, data: OWNED, error: null, requestId: 'r' })
    renderAt('/apps/app-1')

    expect(await screen.findByText('Alpha')).toBeInTheDocument()
    expect(screen.getByText('First demo app')).toBeInTheDocument()
    expect(screen.getByText('active')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /edit this app/i })).toHaveAttribute(
      'href',
      '/apps/app-1/edit',
    )
  })

  it('shows NOT_FOUND (never foreign data) for an RLS-hidden row', async () => {
    getAppMock.mockResolvedValueOnce({
      ok: false,
      data: null,
      error: { code: ErrorCodes.NotFound, message: 'The requested item does not exist (or is not yours).', status: 404 },
      requestId: 'r',
    })
    renderAt('/apps/someone-elses')
    expect(await screen.findByRole('alert')).toHaveTextContent(/does not exist/i)
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument()
  })

  it('deletes the app and navigates back to the list', async () => {
    const user = userEvent.setup()
    getAppMock.mockResolvedValueOnce({ ok: true, data: OWNED, error: null, requestId: 'r' })
    deleteAppMock.mockResolvedValueOnce({ ok: true, data: null, error: null, requestId: 'r' })
    renderAt('/apps/app-1')

    await screen.findByText('Alpha')
    await user.click(screen.getByRole('button', { name: /delete app/i }))

    await waitFor(() => {
      expect(deleteAppMock).toHaveBeenCalledWith('app-1')
      expect(screen.getByText('list landing')).toBeInTheDocument()
    })
  })

  it('surfaces a delete failure instead of navigating', async () => {
    const user = userEvent.setup()
    getAppMock.mockResolvedValueOnce({ ok: true, data: OWNED, error: null, requestId: 'r' })
    deleteAppMock.mockResolvedValueOnce({
      ok: false,
      data: null,
      error: { code: ErrorCodes.Network, message: 'The service is unreachable. Please try again.', status: 0 },
      requestId: 'r',
    })
    renderAt('/apps/app-1')

    await screen.findByText('Alpha')
    await user.click(screen.getByRole('button', { name: /delete app/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/unreachable/i)
    expect(screen.getByText('Alpha')).toBeInTheDocument()
  })

  it('redirects to login when there is no session', async () => {
    function Fixture() {
      return (
        <Routes>
          <Route element={<Outlet context={{ user: null, setUser: () => {} }} />}>
            <Route path="/apps/:id" element={<DetailPage />} />
          </Route>
          <Route path="/login" element={<p>login landing</p>} />
        </Routes>
      )
    }
    render(
      <MemoryRouter initialEntries={['/apps/app-1']}>
        <Fixture />
      </MemoryRouter>,
    )
    await waitFor(() => {
      expect(screen.getByText('login landing')).toBeInTheDocument()
    })
    expect(getAppMock).not.toHaveBeenCalled()
  })
})
