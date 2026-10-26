import { inject } from '@angular/core'
import { CanActivateFn, Router } from '@angular/router'
import { AuthService } from './auth.service'

/**
 * Client-side routing guard (PRD §6 Home): protected screens render only
 * with a session; the backend re-checks on every request anyway.
 */
export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService)
  const router = inject(Router)
  if (auth.user() !== null) return true
  return router.createUrlTree(['/login'])
}
