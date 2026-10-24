import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ListPage } from './List'
import * as dataApi from '../lib/dataApi'
import type { AppRow } from '../lib/database.types'
import { ErrorCodes, type Envelope } from '../lib/envelope'

vi.mock('../lib/dataApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/dataApi')>()
  return {
    ...actual,
    listApps: vi.fn(),
  }
})

const listAppsMock = vi.mocked(dataApi.listApps)

function row(overrides: Partial<AppRow>): AppRow {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    user_id: 'u-1',
    name: 'An app',
    description: '',
    status: 'draft',
    created_at: '2026-01-01T12:00:00Z',
    updated_at: '2026-01-01T12:00:00Z',
    ...overrides,
  }
}

function renderWithUser(email: string | null) {
  function Fixture() {
    return (
      <Routes>
        <Route
          element={
            <Outlet context={{ user: email ? { id: 'u-1', email } : null, setUser: () => {} }} />
          }
        >
          <Route path="/" element={<ListPage />} />
        </Route>
        <Route path="/login" element={<p>login landing</p>} />
      </Routes>
    )
  }
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Fixture />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  listAppsMock.mockReset()
})

describe('ListPage', () => {
  it('renders owned apps with links to details', async () => {
    const a = row({ name: 'Alpha', id: 'a-1' })
    const b = row({ name: 'Beta', id: 'b-1' })
    listAppsMock.mockResolvedValueOnce({ ok: true, data: [a, b], error: null, requestId: 'r' })

    renderWithUser('owner@example.test')

    await waitFor(() => {
      expect(screen.getByTestId('apps-list').children).toHaveLength(2)
    })
    expect(screen.getByRole('link', { name: 'Alpha' })).toHaveAttribute('href', '/apps/a-1')
    expect(screen.getByRole('link', { name: 'Beta' })).toHaveAttribute('href', '/apps/b-1')
  })

  it('shows an explicit empty state with a create link', async () => {
    listAppsMock.mockResolvedValueOnce({ ok: true, data: [], error: null, requestId: 'r' })
    renderWithUser('owner@example.test')
    expect(await screen.findByTestId('apps-empty')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /create your first app/i })).toHaveAttribute(
      'href',
      '/apps/new',
    )
  })

  it('shows an error alert when the data layer fails', async () => {
    const failure: Envelope<never> = {
      ok: false,
      data: null,
      error: { code: ErrorCodes.Network, message: 'The service is unreachable. Please try again.', status: 0 },
      requestId: 'r',
    }
    listAppsMock.mockResolvedValueOnce(failure)
    renderWithUser('owner@example.test')
    expect(await screen.findByRole('alert')).toHaveTextContent(/unreachable/i)
  })

  it('redirects to login when there is no session', async () => {
    renderWithUser(null)
    await waitFor(() => {
      expect(screen.getByText('login landing')).toBeInTheDocument()
    })
    expect(listAppsMock).not.toHaveBeenCalled()
  })
})
