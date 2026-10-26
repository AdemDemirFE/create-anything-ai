/**
 * LoginThrottleInterceptor — fixed-window rate limiting on POST /auth/login
 * keyed by (normalized email, peer IP). Runs BEFORE the handler so locked
 * identities never touch the password verifier. Throws 429 RATE_LIMITED
 * with retryAfterSeconds; the global filter renders the Retry-After header.
 */
import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor } from '@nestjs/common'
import type { Request } from 'express'
import { Observable, throwError } from 'rxjs'
import { catchError, tap } from 'rxjs/operators'
import { ApiError } from './api-error.js'
import { LoginThrottleService } from './login-throttle.service.js'
import { normalizeEmail } from './auth.service.js'

const LOGIN_PATH = '/auth/login'

@Injectable()
export class LoginThrottleInterceptor implements NestInterceptor {
  constructor(@Inject(LoginThrottleService) private readonly throttle: LoginThrottleService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>()
    const isLogin = request.method === 'POST' && request.path.replace(/\/+$/, '').endsWith('/auth/login')
    if (!isLogin) return next.handle()

    const ip = request.ip ?? 'unknown'
    const bodyEmail = typeof request.body === 'object' && request.body !== null ? (request.body as { email?: unknown }).email : undefined
    const email = typeof bodyEmail === 'string' ? normalizeEmail(bodyEmail) : 'unknown'

    this.throttle.assertAllowed(email, ip)

    return next.handle().pipe(
      tap(() => this.throttle.recordSuccess(email, ip)),
      catchError((err: unknown) => {
        if (err instanceof ApiError && err.code === 'INVALID_CREDENTIALS') {
          this.throttle.recordFailure(email, ip)
        }
        return throwError(() => err)
      }),
    )
  }
}
