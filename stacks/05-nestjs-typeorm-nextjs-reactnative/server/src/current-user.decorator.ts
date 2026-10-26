import { createParamDecorator, ExecutionContext } from '@nestjs/common'
import type { Request } from 'express'

interface AuthedRequest extends Request {
  userId?: number
}

/**
 * CurrentUser — injects the session-resolved user id into handler
 * parameters. SessionGuard must run first (it sets request.userId).
 */
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): number => {
  const request = context.switchToHttp().getRequest<AuthedRequest>()
  return request.userId ?? 0
})
