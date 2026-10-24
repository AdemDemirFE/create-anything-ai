import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerServiceWorker } from './pwa'

type Listener = [string, EventListener]

function withServiceWorker(register: ReturnType<typeof vi.fn>) {
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { register },
  })
}

describe('pwa registration', () => {
  // The module attaches a window "load" listener; track and remove every
  // listener registered during a test so nothing leaks across tests.
  let listeners: Listener[] = []
  let originalAdd: typeof window.addEventListener

  beforeEach(() => {
    listeners = []
    originalAdd = window.addEventListener.bind(window)
    vi.spyOn(window, 'addEventListener').mockImplementation((type, cb, opts) => {
      listeners.push([type, cb as EventListener])
      return originalAdd(type, cb, opts)
    })
  })

  afterEach(() => {
    listeners.forEach(([type, cb]) => window.removeEventListener(type, cb))
    listeners = []
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('is a no-op when serviceWorker is unsupported', () => {
    // jsdom has no serviceWorker unless we define it; must not throw.
    expect(() => registerServiceWorker()).not.toThrow()
    expect(listeners).toHaveLength(0)
  })

  it('registers /sw.js on load in production when supported', async () => {
    const register = vi.fn().mockResolvedValue(undefined)
    withServiceWorker(register)
    vi.stubEnv('DEV', false)

    registerServiceWorker()
    expect(listeners.some(([type]) => type === 'load')).toBe(true)
    window.dispatchEvent(new Event('load'))
    await vi.waitFor(() => expect(register).toHaveBeenCalledWith('/sw.js'))
  })

  it('skips registration entirely in dev to keep HMR clean', () => {
    const register = vi.fn()
    withServiceWorker(register)
    vi.stubEnv('DEV', true)

    registerServiceWorker()
    // No load listener is even attached in dev.
    expect(listeners).toHaveLength(0)
    window.dispatchEvent(new Event('load'))
    expect(register).not.toHaveBeenCalled()
  })

  it('swallows registration failures (progressive enhancement)', async () => {
    const register = vi.fn().mockRejectedValue(new Error('quota exceeded'))
    withServiceWorker(register)
    vi.stubEnv('DEV', false)

    expect(() => {
      registerServiceWorker()
      window.dispatchEvent(new Event('load'))
    }).not.toThrow()
    await vi.waitFor(() => expect(register).toHaveBeenCalledWith('/sw.js'))
  })
})
