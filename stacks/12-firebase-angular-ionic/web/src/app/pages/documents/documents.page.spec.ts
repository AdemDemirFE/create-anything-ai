/**
 * Documents page tests — list/add/delete against a stubbed API client.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TestBed } from '@angular/core/testing'
import { AuthService } from '../../auth/auth.service'
import { DocumentsPage } from './documents.page'

describe('DocumentsPage', () => {
  let request: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    request = vi.fn()
    const auth = { client: { request } } as unknown as AuthService
    TestBed.overrideProvider(AuthService, { useValue: auth })
    await TestBed.configureTestingModule({
      imports: [DocumentsPage],
    }).compileComponents()
  })

  afterEach(() => {
    TestBed.resetTestingModule()
  })

  it('loads documents on init and reflects empty state', async () => {
    request.mockResolvedValueOnce({ documents: [], pagination: { page: 1, limit: 20, total: 0, pages: 1 } })
    const fixture = TestBed.createComponent(DocumentsPage)
    fixture.detectChanges()
    await fixture.whenStable()
    fixture.detectChanges()
    expect(request).toHaveBeenCalledWith('/documents?page=1&limit=20')
    expect(fixture.componentInstance.empty()).toBe(true)
    expect(fixture.componentInstance.documents()).toEqual([])
  })

  it('create() posts and refreshes the list', async () => {
    request.mockImplementation((path: string, opts?: { method?: string }) => {
      if (path === '/documents?page=1&limit=20') {
        return Promise.resolve({
          documents: [{ id: 'd1', title: 'T', content: 'c', createdAt: 'x', updatedAt: 'x' }],
          pagination: { page: 1, limit: 20, total: 1, pages: 1 },
        })
      }
      expect(path).toBe('/documents')
      expect(opts?.method).toBe('POST')
      return Promise.resolve({ id: 'd2', title: 'New', content: 'cc', createdAt: 'x', updatedAt: 'x' })
    })
    const fixture = TestBed.createComponent(DocumentsPage)
    await fixture.whenStable()
    fixture.detectChanges()
    fixture.componentInstance.title.set('New')
    fixture.componentInstance.content.set('cc')
    await fixture.componentInstance.create()
    expect(fixture.componentInstance.documents().length).toBe(1)
    expect(fixture.componentInstance.title()).toBe('')
  })

  it('remove() deletes and refreshes', async () => {
    request.mockImplementation((path: string, opts?: { method?: string }) => {
      if (path === '/documents?page=1&limit=20') {
        return Promise.resolve({ documents: [], pagination: { page: 1, limit: 20, total: 0, pages: 1 } })
      }
      expect(path).toBe('/documents/d1')
      expect(opts?.method).toBe('DELETE')
      return Promise.resolve(null)
    })
    const fixture = TestBed.createComponent(DocumentsPage)
    await fixture.whenStable()
    fixture.detectChanges()
    await fixture.componentInstance.remove('d1')
    expect(fixture.componentInstance.error()).toBeNull()
  })
})
