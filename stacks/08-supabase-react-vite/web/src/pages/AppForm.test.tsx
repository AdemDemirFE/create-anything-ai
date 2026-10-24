import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppFormPage } from './AppForm'
import * as dataApi from '../lib/dataApi'
import type { AppRow } from '../lib/database.types'
import { ErrorCodes } from '../lib/envelope'

vi.mock('../lib/dataApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/dataApi')>()
  return {
    ...actual,
    createApp: vi.fn(),
    updateApp: vi.fn(),
    getApp: vi.fn(),
  }
})

const createAppMock = vi.mocked(dataApi.createApp)
const updateAppMock = vi.mocked(dataApi.updateApp)
const getAppMock = vi.mocked(dataApi.getApp)

function createdRow(): AppRow {
  return {
    id: 'app-new',
    user_id: 'u-1',
    name: 'Created App',
    description: '',
    status: 'draft',
    created_at: '2026-01-01T12:00:00Z',
    updated_at: '2026-01-01T12:00:00Z',
  }
}

function renderAt(path: string) {
  function Fixture() {
    return (
      <Routes>
        <Route
          element={<Outlet context={{ user: { id: 'u-1', email: 'owner@example.test' }, setUser: () => {} }} />}
        >
          <Route path="/apps/new" element={<AppFormPage />} />
          <Route path="/apps/:id/edit" element={<AppFormPage />} />
        </Route>
        <Route path="/login" element={<p>login landing</p>} />
        <Route path="/apps" element={<p>list landing</p>} />
        <Route path="/apps/:id" element={<p>detail landing</p>} />
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
  createAppMock.mockReset()
  updateAppMock.mockReset()
  getAppMock.mockReset()
})

describe('AppFormPage (create)', () => {
  it('submits a new app and navigates to its detail', async () => {
    const user = userEvent.setup()
    createAppMock.mockResolvedValueOnce({ ok: true, data: createdRow(), error: null, requestId: 'r' })

    renderAt('/apps/new')
    await user.type(screen.getByLabelText(/^Name /i), 'Created App')
    await user.type(screen.getByLabelText(/^Description /i), 'hello world')
    await user.click(screen.getByRole('button', { name: /create app/i }))

    await waitFor(() => {
      expect(createAppMock).toHaveBeenCalledWith({
        name: 'Created App',
        description: 'hello world',
        status: 'draft',
      })
      expect(screen.getByText('detail landing')).toBeInTheDocument()
    })
  })

  it('shows validation feedback without a network call for an empty name', async () => {
    const user = userEvent.setup()
    renderAt('/apps/new')

    await user.click(screen.getByRole('button', { name: /create app/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/name is required/i)
    expect(createAppMock).not.toHaveBeenCalled()
  })

  it('shows the duplicate-name conflict from the unique constraint', async () => {
    const user = userEvent.setup()
    createAppMock.mockResolvedValueOnce({
      ok: false,
      data: null,
      error: { code: ErrorCodes.Conflict, message: 'That value conflicts with an existing one.', status: 409 },
      requestId: 'r',
    })

    renderAt('/apps/new')
    await user.type(screen.getByLabelText(/^Name /i), 'Duplicate')
    await user.click(screen.getByRole('button', { name: /create app/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/conflicts/i)
  })

  it('enforces the name bound client-side (81 chars rejected, 80 accepted by input)', async () => {
    renderAt('/apps/new')

    const nameInput = screen.getByLabelText(/^Name /i) as HTMLInputElement
    expect(nameInput.maxLength).toBe(80)
  })
})

describe('AppFormPage (edit)', () => {
  it('loads the owned app and submits changes', async () => {
    const user = userEvent.setup()
    getAppMock.mockResolvedValueOnce({
      ok: true,
      data: { ...createdRow(), id: 'app-1', name: 'Original', status: 'active' },
      error: null,
      requestId: 'r',
    })
    updateAppMock.mockResolvedValueOnce({
      ok: true,
      data: { ...createdRow(), id: 'app-1', name: 'Renamed', status: 'archived' },
      error: null,
      requestId: 'r',
    })

    renderAt('/apps/app-1/edit')
    expect(await screen.findByLabelText(/^Name /i)).toHaveValue('Original')

    await user.clear(screen.getByLabelText(/^Name /i))
    await user.type(screen.getByLabelText(/^Name /i), 'Renamed')
    await user.selectOptions(screen.getByLabelText(/status/i), 'archived')
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => {
      expect(updateAppMock).toHaveBeenCalledWith('app-1', {
        name: 'Renamed',
        description: '',
        status: 'archived',
      })
      expect(screen.getByText('detail landing')).toBeInTheDocument()
    })
  })

  it('surfaces NOT_FOUND when the app is not owned/visible', async () => {
    getAppMock.mockResolvedValueOnce({
      ok: false,
      data: null,
      error: { code: ErrorCodes.NotFound, message: 'The requested item does not exist (or is not yours).', status: 404 },
      requestId: 'r',
    })
    renderAt('/apps/foreign-id/edit')
    expect(await screen.findByRole('alert')).toHaveTextContent(/does not exist/i)
  })
})
