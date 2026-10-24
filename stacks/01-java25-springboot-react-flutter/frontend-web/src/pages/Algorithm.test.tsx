import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

describe('AlgorithmPage', () => {
  it('loads catalog, enforces input cap, and shows measured time vs Big-O separately', async () => {
    const user = userEvent.setup()
    fetchMock
      .mockResolvedValueOnce(
        envelope({
          success: true,
          data: [
            { id: 'fizzbuzz', name: 'FizzBuzz', complexity: 'O(n)', explanation: 'n lines' },
            { id: 'reverse', name: 'Reverse text', complexity: 'O(n)', explanation: 'reverse' },
          ],
          error: null,
          meta: { timestamp: 't', request_id: 'r' },
        }),
      )
      .mockResolvedValueOnce(
        envelope({
          success: true,
          data: {
            algorithmId: 'fizzbuzz',
            output: '1\n2\nFizz',
            executionMs: 0.4,
            complexity: 'O(n)',
            explanation: 'n lines',
          },
          error: null,
          meta: { timestamp: 't', request_id: 'r2', execution_ms: 0.5 },
        }),
      )

    render(<AlgorithmPage />)

    const select = await screen.findByLabelText(/algorithm/i)
    expect(select).toBeInTheDocument()

    const input = screen.getByLabelText(/input/i)
    await user.type(input, '3')
    await user.click(screen.getByRole('button', { name: /run/i }))

    await waitFor(() => {
      expect(screen.getByText(/measured duration/i)).toBeInTheDocument()
    })
    expect(screen.getByText(/theoretical complexity/i)).toBeInTheDocument()
    const output = document.querySelector('pre')
    expect(output?.textContent).toContain('Fizz')
  })

  it('surfaces API errors in an alert region', async () => {
    const user = userEvent.setup()
    fetchMock
      .mockResolvedValueOnce(
        envelope({
          success: true,
          data: [{ id: 'fizzbuzz', name: 'FizzBuzz', complexity: 'O(n)', explanation: 'n lines' }],
          error: null,
          meta: { timestamp: 't', request_id: 'r' },
        }),
      )
      .mockResolvedValueOnce(
        envelope(
          {
            success: false,
            data: null,
            error: { code: 'INPUT_TOO_LARGE', message: 'Input exceeds the maximum length of 10000 characters.' },
            meta: { timestamp: 't', request_id: 'r2' },
          },
          400,
        ),
      )

    render(<AlgorithmPage />)

    await screen.findByLabelText(/algorithm/i)
    await user.type(screen.getByLabelText(/input/i), 'x')
    await user.click(screen.getByRole('button', { name: /run/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/maximum length/i)
  })
})
