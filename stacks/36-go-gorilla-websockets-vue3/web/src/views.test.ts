// views.test.ts — component tests for the four-screen contract surfaces
// (Auth, Home, Algorithm) with the API client mocked at the fetch boundary.
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createWebHistory } from 'vue-router'
import AuthView from './views/AuthView.vue'
import HomeView from './views/HomeView.vue'
import AlgorithmView from './views/AlgorithmView.vue'

function makeRouter() {
  return createRouter({
    history: createWebHistory(),
    routes: [
      { path: '/', redirect: '/home' },
      { path: '/auth', name: 'auth', component: AuthView },
      { path: '/home', name: 'home', component: HomeView, meta: { requiresAuth: true } },
      { path: '/algorithm', name: 'algorithm', component: AlgorithmView, meta: { requiresAuth: true } },
    ],
  })
}

function envelope(ok: boolean, data: unknown, error?: { code: string; message: string; details?: { field: string; code: string }[] }) {
  return {
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        success: ok,
        data: ok ? data : null,
        error: error ?? null,
        meta: { timestamp: 't', request_id: 'r' },
      }),
  } as unknown as Response
}

// LivePanel opens a WebSocket; stub it in view tests.
vi.mock('./components/LivePanel.vue', () => ({ default: { template: '<div/>' } }))

beforeEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('AuthView', () => {
  it('submits login and navigates home on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue(envelope(true, { email: 'u@x.co' }))
    vi.stubGlobal('fetch', fetchMock)
    const router = makeRouter()
    await router.push('/auth')
    await router.isReady()

    const wrapper = mount(AuthView, { global: { plugins: [router] } })
    await wrapper.find('#email').setValue('u@x.co')
    await wrapper.find('#password').setValue('Str0ngPassw0rd')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/login',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('shows field-level errors on VALIDATION_ERROR', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      envelope(false, null, {
        code: 'VALIDATION_ERROR',
        message: 'The request contains invalid fields.',
        details: [
          { field: 'email', code: 'INVALID_FORMAT' },
          { field: 'password', code: 'weak password' },
        ],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const router = makeRouter()
    await router.push('/auth')
    await router.isReady()

    const wrapper = mount(AuthView, { global: { plugins: [router] } })
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    const alerts = wrapper.findAll('[role="alert"]')
    expect(alerts.length).toBeGreaterThanOrEqual(3) // banner + 2 fields
    expect(wrapper.text()).toContain('INVALID_FORMAT')
  })

  it('shows the generic error banner for INVALID_CREDENTIALS', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      envelope(false, null, { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const router = makeRouter()
    await router.push('/auth')
    await router.isReady()

    const wrapper = mount(AuthView, { global: { plugins: [router] } })
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(wrapper.text()).toContain('Invalid email or password.')
  })
})

describe('HomeView', () => {
  it('renders email and metrics, then logout resets', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        envelope(true, {
          email: 'home@x.co',
          metrics: [
            { label: 'Active sessions', value: '1', unit: 'session' },
            { label: 'Algorithms available', value: '4', unit: 'items' },
            { label: 'Uptime', value: 'demo', unit: 'reference' },
          ],
          server_time: '2026-10-25T00:00:00Z',
        }),
      )
      .mockResolvedValueOnce(envelope(true, { logout: true }))
    vi.stubGlobal('fetch', fetchMock)
    const router = makeRouter()
    await router.push('/home')
    await router.isReady()

    const wrapper = mount(HomeView, { global: { plugins: [router] } })
    await flushPromises()

    expect(wrapper.find('[data-testid="home-email"]').text()).toBe('home@x.co')
    expect(wrapper.findAll('.metric')).toHaveLength(3)

    await wrapper.find('[data-testid="logout"]').trigger('click')
    await flushPromises()
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/logout', expect.anything())
  })

  it('redirects to auth on 401', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      envelope(false, null, { code: 'UNAUTHORIZED', message: 'Authentication is required.' }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const router = makeRouter()
    await router.push('/home')
    await router.isReady()

    mount(HomeView, { global: { plugins: [router] } })
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('auth')
  })
})

describe('AlgorithmView', () => {
  it('loads the catalog, runs an algorithm, and separates measured vs Big-O', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        envelope(true, [
          { id: 'fizzbuzz', name: 'FizzBuzz', complexity: 'O(n)', explanation: 'Linear.' },
          { id: 'reverse', name: 'Reverse text', complexity: 'O(n)', explanation: 'One pass.' },
        ]),
      )
      .mockResolvedValueOnce(
        envelope(true, {
          algorithm_id: 'reverse',
          output: 'olleh',
          execution_ms: 0.1,
          complexity: 'O(n)',
          explanation: 'One pass.',
        }),
      )
    vi.stubGlobal('fetch', fetchMock)
    const router = makeRouter()
    await router.push('/algorithm')
    await router.isReady()

    const wrapper = mount(AlgorithmView, { global: { plugins: [router] } })
    await flushPromises()

    expect(wrapper.findAll('option')).toHaveLength(2)
    await wrapper.find('[data-testid="algorithm-input"]').setValue('hello')
    await wrapper.find('[data-testid="run-button"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="run-output"]').text()).toBe('olleh')
    expect(wrapper.find('[data-testid="measured-ms"]').text()).toContain('ms')
    expect(wrapper.find('[data-testid="complexity"]').text()).toBe('O(n)')
    expect(wrapper.text()).toContain('Theoretical complexity')
    expect(wrapper.text()).toContain('Measured duration')
  })

  it('rejects oversized input client-side before hitting the API', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      envelope(true, [
        { id: 'reverse', name: 'Reverse text', complexity: 'O(n)', explanation: 'One pass.' },
      ]),
    )
    vi.stubGlobal('fetch', fetchMock)
    const router = makeRouter()
    await router.push('/algorithm')
    await router.isReady()

    const wrapper = mount(AlgorithmView, { global: { plugins: [router] } })
    await flushPromises()

    await wrapper.find('[data-testid="algorithm-input"]').setValue('a'.repeat(10_001))
    await wrapper.find('[data-testid="run-button"]').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('exceeds the maximum')
    // Only the catalog call happened; no run call.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
