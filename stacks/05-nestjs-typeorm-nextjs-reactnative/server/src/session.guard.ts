/**
 * SessionGuard — GLOBAL by default: every route requires a session unless
 * marked @Public() (auth register/login, health, algorithm catalog/run).
 * Resolves the session cookie to request.userId for @CurrentUser().
 */
import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { Request } from 'express'
import { ApiError } from './api-error.js'
import { ERROR_CODES } from './error-codes.js'
import { AuthService } from './auth.service.js'
import { SessionService } from './session.service.js'
import { IS_PUBLIC_KEY } from './public.decorator.js'

interface AuthedRequest extends Request {
  userId?: number
}

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (isPublic) return true

    const request = context.switchToHttp().getRequest<AuthedRequest>()
    const token = request.cookies?.[this.auth.sessionCookieName]
    const userId = await this.sessions.resolve(token)
    if (userId === null) {
      throw new ApiError(ERROR_CODES.UNAUTHORIZED, 'Sign in to continue.', 401)
    }
    request.userId = userId
    return true
  }
}
