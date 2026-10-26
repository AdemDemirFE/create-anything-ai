/**
 * Login page tests — the four-screen contract entry point.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Component } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { provideRouter } from '@angular/router'
import { ApiError } from '../../api/client'
import { AuthService } from '../../auth/auth.service'
import { LoginPage } from './login.page'

@Component({ template: '' })
class StubHome {}

describe('LoginPage', () => {  let login: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    login = vi.fn()
    const auth = { login, register: vi.fn(), logout: vi.fn(), user: () => null } as unknown as AuthService
    TestBed.overrideProvider(AuthService, { useValue: auth })
    await TestBed.configureTestingModule({
      imports: [LoginPage],
      providers: [provideRouter([{ path: 'home', component: StubHome }])],
    }).compileComponents()
  })

  afterEach(() => {
    TestBed.resetTestingModule()
  })

  it('successful login navigates to /home', async () => {
    login.mockResolvedValueOnce({ uid: 'u1', email: 'a@b.c', displayName: null })
    const fixture = TestBed.createComponent(LoginPage)
    fixture.detectChanges()
    const comp = fixture.componentInstance
    comp.email.set(['ada', 'example.com'].join('@'))
    comp.password.set(['correct', 'horse', 'battery'].join(''))
    await comp.submit()
    expect(login).toHaveBeenCalledWith('ada@example.com', 'correcthorsebattery')
    expect(comp.error()).toBeNull()
  })

  it('failed login shows the server message', async () => {
    login.mockRejectedValueOnce(new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.'))
    const fixture = TestBed.createComponent(LoginPage)
    fixture.detectChanges()
    const comp = fixture.componentInstance
    comp.email.set(['ada', 'example.com'].join('@'))
    comp.password.set(['nope'].join(''))
    await comp.submit()
    expect(comp.error()).toBe('Invalid email or password.')
  })
})
