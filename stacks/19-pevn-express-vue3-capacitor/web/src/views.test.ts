// views.test.ts — component tests for the four-screen contract surfaces
// (Auth, Home, Algorithm, Documents) with the API client mocked at the
// module boundary. Same structure as the Stack-18 React suite, Vue-flavored.
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createWebHistory, type Router } from 'vue-router'
import RegisterView from './views/RegisterView.vue'
import LoginView from './views/LoginView.vue'
import HomeView from './views/HomeView.vue'
import AlgorithmView from './views/AlgorithmView.vue'
import DocumentsView from './views/DocumentsView.vue'
import { ApiError } from './api/client'

vi.mock('./api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api/client')>()
  return {
    ...actual,
    api: {
      register: vi.fn(),
      login: vi.fn(),
      logout: vi.fn(),
      home: vi.fn(),
      algorithms: vi.fn(),
      runAlgorithm: vi.fn(),
      listDocuments: vi.fn(),
      getDocument: vi.fn(),
      createDocument: vi.fn(),
      updateDocument: vi.fn(),
      deleteDocument: vi.fn(),
    },
  }
})

vi.mock('./auth', () => ({
  isAuthenticated: vi.fn().mockResolvedValue(true),
  resetAuthCache: vi.fn(),
}))

import { api } from './api/client'

function makeRouter(): Router {
  return createRouter({
    history: createWebHistory(),
    routes: [
      { path: '/', redirect: '/login' },
      { path: '/register', name: 'register', component: RegisterView },
      { path: '/login', name: 'login', component: LoginView },
      { path: '/home', name: 'home', component: HomeView },
      { path: '/algorithm', name: 'algorithm', component: AlgorithmView },
      { path: '/documents', name: 'documents', component: DocumentsView },
    ],
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('RegisterView', () => {
  it('renders accessible labels for email and password', () => {
    const wrapper = mount(RegisterView, { global: { plugins: [makeRouter()] } })
    expect(wrapper.find('label[for="register-email"]').exists()).toBe(true)
    expect(wrapper.find('label[for="register-password"]').exists()).toBe(true)
  })

  it('submits credentials on success', async () => {
    vi.mocked(api.register).mockResolvedValueOnce({
      ok: true,
      data: { user: { id: 'u1', email: 'a@b.co' } },
      error: null,
      requestId: 'r',
    })
    const wrapper = mount(RegisterView, { global: { plugins: [makeRouter()] } })
    await wrapper.find('#register-email').setValue('a@b.co')
    await wrapper.find('#register-password').setValue('correct horse battery')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(api.register).toHaveBeenCalledWith('a@b.co', 'correct horse battery')
  })

  it('shows the duplicate-email message on EMAIL_TAKEN', async () => {
    vi.mocked(api.register).mockRejectedValueOnce(
      new ApiError('EMAIL_TAKEN', 'An account with this email already exists.', 409, 'r'),
    )
    const wrapper = mount(RegisterView, { global: { plugins: [makeRouter()] } })
    await wrapper.find('#register-email').setValue('dupe@b.co')
    await wrapper.find('#register-password').setValue('correct horse battery')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(wrapper.find('[role="alert"]').text()).toContain('An account with this email already exists.')
  })

  it('maps field-level details to inline errors', async () => {
    vi.mocked(api.register).mockRejectedValueOnce(
      new ApiError('VALIDATION_ERROR', 'The request contains invalid fields.', 400, 'r', [
        { field: 'email', code: 'INVALID_FORMAT' },
      ]),
    )
    const wrapper = mount(RegisterView, { global: { plugins: [makeRouter()] } })
    await wrapper.find('#register-email').setValue('nope')
    await wrapper.find('#register-password').setValue('correct horse battery')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(wrapper.text()).toContain('Email is invalid.')
  })
})

describe('LoginView', () => {
  it('shows the generic error message on INVALID_CREDENTIALS (no enumeration)', async () => {
    vi.mocked(api.login).mockRejectedValueOnce(
      new ApiError('INVALID_CREDENTIALS', 'Invalid email or password.', 401, 'r'),
    )
    const wrapper = mount(LoginView, { global: { plugins: [makeRouter()] } })
    await wrapper.find('#login-email').setValue('a@b.co')
    await wrapper.find('#login-password').setValue('wrong password')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(wrapper.find('[role="alert"]').text()).toContain('Invalid email or password.')
  })

  it('surfaces the throttled message on 429', async () => {
    vi.mocked(api.login).mockRejectedValueOnce(
      new ApiError('RATE_LIMITED', 'Too many failed login attempts. Try again later.', 429, 'r'),
    )
    const wrapper = mount(LoginView, { global: { plugins: [makeRouter()] } })
    await wrapper.find('#login-email').setValue('a@b.co')
    await wrapper.find('#login-password').setValue('correct horse battery')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(wrapper.find('[role="alert"]').text()).toContain('Too many failed login attempts.')
  })
})

describe('HomeView', () => {
  it('renders the profile and metrics after loading, and logs out', async () => {
    const homeEnvelope = {
      ok: true,
      data: {
        email: 'home@b.co',
        metrics: [{ label: 'Stored documents', value: '2', unit: 'count' }],
        serverTime: '2026-01-01T00:00:00Z',
      },
      error: null,
      requestId: 'r',
    }
    vi.mocked(api.home).mockResolvedValueOnce(homeEnvelope)
    vi.mocked(api.logout).mockResolvedValue({ ok: true, data: null, error: null, requestId: 'r' })
    const wrapper = mount(HomeView, { global: { plugins: [makeRouter()] } })
    await flushPromises()

    expect(wrapper.text()).toContain('Signed in as')
    expect(wrapper.text()).toContain('home@b.co')
    expect(wrapper.text()).toContain('Stored documents')

    await wrapper.find('button').trigger('click')
    await flushPromises()
    expect(api.logout).toHaveBeenCalled()
  })

  it('shows the error state when home fails', async () => {
    vi.mocked(api.home).mockRejectedValueOnce(
      new ApiError('NETWORK_ERROR', 'The service is unreachable. Please try again.', 0, 'n/a'),
    )
    const wrapper = mount(HomeView, { global: { plugins: [makeRouter()] } })
    await flushPromises()
    expect(wrapper.find('[role="alert"]').text()).toContain('The service is unreachable.')
  })

  it('shows a loading state initially', () => {
    vi.mocked(api.home).mockReturnValue(new Promise(() => {}))
    const wrapper = mount(HomeView, { global: { plugins: [makeRouter()] } })
    expect(wrapper.text()).toContain('Loading…')
  })
})

describe('AlgorithmView', () => {
  const catalog = [
    { id: 'fizzbuzz', name: 'FizzBuzz', complexity: 'O(n)', explanation: 'One line per number.' },
    { id: 'reverse', name: 'Reverse text', complexity: 'O(n)', explanation: 'Single reversed copy.' },
  ]

  it('loads the catalog and shows the selected algorithm explanation', async () => {
    vi.mocked(api.algorithms).mockResolvedValueOnce({ ok: true, data: catalog, error: null, requestId: 'r' })
    const wrapper = mount(AlgorithmView, { global: { plugins: [makeRouter()] } })
    await flushPromises()
    expect(wrapper.findAll('option')).toHaveLength(2)
    expect(wrapper.text()).toContain('One line per number.')
  })

  it('runs an algorithm and displays measured duration separately from Big-O', async () => {
    vi.mocked(api.algorithms).mockResolvedValueOnce({ ok: true, data: catalog, error: null, requestId: 'r' })
    vi.mocked(api.runAlgorithm).mockResolvedValueOnce({
      ok: true,
      data: { algorithmId: 'reverse', output: 'kcats', executionMs: 0.42, complexity: 'O(n)', explanation: 'Single reversed copy.' },
      error: null,
      requestId: 'r',
    })
    const wrapper = mount(AlgorithmView, { global: { plugins: [makeRouter()] } })
    await flushPromises()
    await wrapper.find('#algorithm-input').setValue('stack')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(wrapper.find('pre').text()).toContain('kcats')
    expect(wrapper.text()).toContain('Measured duration: 0.4 ms')
    expect(wrapper.text()).toContain('Theoretical complexity: O(n)')
  })

  it('shows INPUT_TOO_LARGE errors from the server', async () => {
    vi.mocked(api.algorithms).mockResolvedValueOnce({ ok: true, data: catalog, error: null, requestId: 'r' })
    vi.mocked(api.runAlgorithm).mockRejectedValueOnce(
      new ApiError('INPUT_TOO_LARGE', 'Input exceeds the maximum length of 10000 characters.', 400, 'r'),
    )
    const wrapper = mount(AlgorithmView, { global: { plugins: [makeRouter()] } })
    await flushPromises()
    await wrapper.find('#algorithm-input').setValue('x')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(wrapper.find('[role="alert"]').text()).toContain('Input exceeds the maximum length')
  })
})

describe('DocumentsView', () => {
  const documents = [
    { id: 'd1', title: 'First note', content: 'hello', tags: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
    { id: 'd2', title: 'Second note', content: 'world', tags: ['tag'], createdAt: '2026-01-02T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z' },
  ]

  function listEnvelope(docs: typeof documents) {
    return {
      ok: true,
      data: { documents: docs, pagination: { page: 1, limit: 10, total: docs.length, pages: 1 } },
      error: null,
      requestId: 'r',
    }
  }

  it('lists documents with pagination info', async () => {
    vi.mocked(api.listDocuments).mockResolvedValueOnce(listEnvelope(documents))
    const wrapper = mount(DocumentsView, { global: { plugins: [makeRouter()] } })
    await flushPromises()
    expect(wrapper.text()).toContain('First note')
    expect(wrapper.text()).toContain('Second note')
    expect(wrapper.text()).toContain('Your documents (2)')
  })

  it('shows the empty state', async () => {
    vi.mocked(api.listDocuments).mockResolvedValueOnce(listEnvelope([]))
    const wrapper = mount(DocumentsView, { global: { plugins: [makeRouter()] } })
    await flushPromises()
    expect(wrapper.text()).toContain('No documents yet. Create your first one above.')
  })

  it('creates a document and reloads the list', async () => {
    vi.mocked(api.listDocuments)
      .mockResolvedValueOnce(listEnvelope([]))
      .mockResolvedValueOnce(listEnvelope(documents))
    vi.mocked(api.createDocument).mockResolvedValueOnce({
      ok: true,
      data: { document: documents[0] },
      error: null,
      requestId: 'r',
    })
    const wrapper = mount(DocumentsView, { global: { plugins: [makeRouter()] } })
    await flushPromises()
    await wrapper.find('#doc-title').setValue('First note')
    await wrapper.find('#doc-content').setValue('hello')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(api.createDocument).toHaveBeenCalledWith('First note', 'hello')
    expect(wrapper.text()).toContain('Your documents (2)')
  })

  it('deletes a document and reloads', async () => {
    vi.mocked(api.listDocuments)
      .mockResolvedValueOnce(listEnvelope(documents))
      .mockResolvedValueOnce(listEnvelope([documents[1]]))
    vi.mocked(api.deleteDocument).mockResolvedValueOnce({ ok: true, data: { deletedId: 'd1' }, error: null, requestId: 'r' })
    const wrapper = mount(DocumentsView, { global: { plugins: [makeRouter()] } })
    await flushPromises()
    await wrapper.find('button[aria-label="Delete First note"]').trigger('click')
    await flushPromises()
    expect(api.deleteDocument).toHaveBeenCalledWith('d1')
    expect(wrapper.text()).not.toContain('First note')
  })

  it('shows the error state on failure', async () => {
    vi.mocked(api.listDocuments).mockRejectedValueOnce(
      new ApiError('NETWORK_ERROR', 'The service is unreachable. Please try again.', 0, 'n/a'),
    )
    const wrapper = mount(DocumentsView, { global: { plugins: [makeRouter()] } })
    await flushPromises()
    expect(wrapper.find('[role="alert"]').text()).toContain('Could not load documents.')
  })
})
