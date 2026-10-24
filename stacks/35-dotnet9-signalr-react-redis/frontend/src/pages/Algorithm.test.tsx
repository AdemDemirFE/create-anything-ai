import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AlgorithmPage } from './Algorithm'

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})

function envelope(body: object, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

const CATALOG = [
  { id: 'fizzbuzz', name: 'FizzBuzz', complexity: 'O(n)', explanation: 'Counts through 1..n.' },
  { id: 'palindrome', name: 'Palindrome', complexity: 'O(n)', explanation: 'Checks symmetric text.' },
  { id: 'fibonacci', name: 'Fibonacci', complexity: 'O(n)', explanation: 'Iterative sequence.' },
  { id: 'reverse', name: 'Reverse', complexity: 'O(n)', explanation: 'Reverses the input.' },
]

function renderWithUser() {
  return render(
    <MemoryRouter initialEntries={['/algorithm']}>
      <Routes>
        <Route element={<Outlet context={{ user: 'a@b.co', setUser: () => {} }} />}>
          <Route path="/algorithm" element={<AlgorithmPage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

describe('AlgorithmPage', () => {
  it('loads the algorithm catalog and preselects the first entry', async () => {
    fetchMock.mockResolvedValueOnce(
      envelope({
        success: true,
        data: CATALOG,
        error: null,
        meta: { timestamp: 't', request_id: 'r' },
      }),
    )

    renderWithUser()

    const select = await screen.findByLabelText(/algorithm/i)
    await waitFor(() => {
      expect(select).toHaveValue('fizzbuzz')
    })
    expect(screen.getAllByRole('option')).toHaveLength(4)
    expect(screen.getByText('Palindrome (O(n))')).toBeInTheDocument()
    expect(screen.getByText(/counts through 1\.\.n\./i)).toBeInTheDocument()
  })

  it('caps the input at 10,000 characters and shows the counter', async () => {
    fetchMock.mockResolvedValueOnce(
      envelope({ success: true, data: CATALOG, error: null, meta: { timestamp: 't', request_id: 'r' } }),
    )

    renderWithUser()

    const input = await screen.findByLabelText(/input \(max/i)
    // The textarea enforces the bound itself via the maxLength attribute.
    expect(input).toHaveAttribute('maxLength', '10000')

    // Drive one change event with an over-limit value: React clamps to
    // maxLength, so state and the counter must show exactly 10,000.
    fireEvent.change(input, { target: { value: 'x'.repeat(10_050) } })

    console.log('DEBUG value length after change:', (input as HTMLTextAreaElement).value.length)

    expect(input).toHaveValue('x'.repeat(10_000))

    // The counter is locale-formatted (comma vs dot separators); build the
    // expected string with the same Intl formatting the component uses.
    const formatted = (10_000).toLocaleString()
    expect(screen.getByText(`${formatted} / ${formatted} characters`)).toBeInTheDocument()
  })

  it('shows measured duration and theoretical complexity separately after a run', async () => {
    fetchMock
      .mockResolvedValueOnce(
        envelope({ success: true, data: CATALOG, error: null, meta: { timestamp: 't', request_id: 'r' } }),
      )
      .mockResolvedValueOnce(
        envelope({
          success: true,
          data: {
            algorithmId: 'reverse',
            output: 'cba',
            executionMs: 1.2,
            complexity: 'O(n)',
            explanation: 'Reverses the input.',
          },
          error: null,
          meta: { timestamp: 't', request_id: 'r', execution_ms: 1.2 },
        }),
      )

    renderWithUser()

    const input = await screen.findByLabelText(/input \(max/i)
    const user = userEvent.setup()
    await user.type(input, 'abc')
    await user.click(screen.getByRole('button', { name: /run/i }))

    const measured = await screen.findByText(/measured duration/i)
    expect(measured).toHaveTextContent('1.2 ms')
    // Big-O is presented on its own line, not conflated with the timing.
    const complexity = screen.getByText(/theoretical complexity/i)
    expect(complexity).toHaveTextContent('O(n)')
    expect(measured.textContent).not.toContain('O(n)')
    expect(screen.getByText('cba')).toBeInTheDocument()
  })

  it('redirects to login when there is no session', () => {
    render(
      <MemoryRouter initialEntries={['/algorithm']}>
        <Routes>
          <Route element={<Outlet context={{ user: null, setUser: () => {} }} />}>
            <Route path="/algorithm" element={<AlgorithmPage />} />
            <Route path="/login" element={<p>Login page</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByText('Login page')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows an alert when the catalog fails to load', async () => {
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

    renderWithUser()

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load the algorithm catalog/i)
  })
})
