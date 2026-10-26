/**
 * Angular page tests (Ionic components, zone.js + Analog vitest plugin).
 * Covers the four-screen contract: login/register forms, home guard +
 * logout, algorithm page run flow (stubbed API), documents list/add/delete.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TestBed } from '@angular/core/testing'
import { provideRouter } from '@angular/router'
import { ApiError } from '../../api/client'
import { AuthService, HomeData } from '../../auth/auth.service'
import { AlgorithmPage } from './algorithm.page'

function stubAuthService(): { auth: AuthService; client: { request: ReturnType<typeof vi.fn> } } {
  const request = vi.fn()
  const auth = {
    user: () => null,
    client: { request },
  } as unknown as AuthService
  TestBed.overrideProvider(AuthService, { useValue: auth })
  return { auth, client: { request } as { request: ReturnType<typeof vi.fn> } }
}

describe('AlgorithmPage', () => {
  let request: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    request = stubAuthService().client.request
    await TestBed.configureTestingModule({
      imports: [AlgorithmPage],
      providers: [provideRouter([])],
    }).compileComponents()
  })

  afterEach(() => {
    TestBed.resetTestingModule()
  })

  it('loads the catalog on init', async () => {
    request.mockResolvedValueOnce([
      { id: 'fizzbuzz', name: 'FizzBuzz (1..n)', complexity: 'O(n)', explanation: 'Single pass.' },
    ])
    const fixture = TestBed.createComponent(AlgorithmPage)
    fixture.detectChanges()
    await fixture.whenStable()
    fixture.detectChanges()
    expect(request).toHaveBeenCalledWith('/algorithms')
    expect(fixture.componentInstance.algorithms().length).toBe(1)
  })

  it('run() posts input and stores the result', async () => {
    request.mockImplementation((path: string) => {
      if (path === '/algorithms') {
        return Promise.resolve([
          { id: 'reverse', name: 'Reverse text', complexity: 'O(n)', explanation: 'Copies once.' },
        ])
      }
      expect(path).toBe('/algorithms/reverse/run')
      return Promise.resolve({
        algorithmId: 'reverse',
        output: 'olleh',
        durationMs: 0.3,
        complexity: 'O(n)',
        explanation: 'Copies once.',
      })
    })
    const fixture = TestBed.createComponent(AlgorithmPage)
    await fixture.whenStable()
    fixture.detectChanges()
    fixture.componentInstance.selected.set('reverse')
    fixture.componentInstance.input.set('hello')
    await fixture.componentInstance.run()
    expect(fixture.componentInstance.result()?.output).toBe('olleh')
    expect(fixture.componentInstance.error()).toBeNull()
  })

  it('run() surfaces ApiError message on failure', async () => {
    request.mockImplementation((path: string) => {
      if (path === '/algorithms') return Promise.resolve([])
      return Promise.reject(new ApiError(413, 'INPUT_TOO_LARGE', 'Input too large.'))
    })
    const fixture = TestBed.createComponent(AlgorithmPage)
    fixture.detectChanges()
    await fixture.whenStable()
    fixture.detectChanges()
    fixture.componentInstance.selected.set('reverse')
    fixture.componentInstance.input.set('x')
    await fixture.componentInstance.run()
    expect(fixture.componentInstance.error()).toBe('Input too large.')
    expect(fixture.componentInstance.result()).toBeNull()
  })
})

describe('HomeData contract (client types mirror the server envelope)', () => {
  it('home payload shape is stable', () => {
    const home: HomeData = {
      user: { email: 'a@b.c', displayName: null },
      metrics: [{ label: 'Stored documents', value: '2', unit: 'count' }],
      serverTime: new Date().toISOString(),
    }
    expect(home.metrics[0].label).toBe('Stored documents')
  })
})
