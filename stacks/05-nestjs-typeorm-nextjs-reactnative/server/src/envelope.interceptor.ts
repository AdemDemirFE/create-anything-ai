/**
 * EnvelopeInterceptor — wraps EVERY successful response in the contract
 * envelope and stamps the X-Request-Id response header. The request id is
 * generated per request (CSPRNG, contract shape [A-Za-z0-9-]{1,64}); an
 * inbound X-Request-Id header is honored only when it matches the shape,
 * otherwise a fresh id is issued (never echo unvalidated input).
 */
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common'
import { Response } from 'express'
import { Observable } from 'rxjs'
import { map } from 'rxjs/operators'
import { REQUEST_ID_PATTERN, newRequestId } from './envelope-types.js'

export const REQUEST_ID_HEADER = 'x-request-id'

@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const response = context.switchToHttp().getResponse<Response>()
    const request = context.switchToHttp().getRequest<{ headers?: Record<string, string | undefined> }>()

    const inbound = request.headers?.[REQUEST_ID_HEADER]
    const requestId = typeof inbound === 'string' && REQUEST_ID_PATTERN.test(inbound) ? inbound : newRequestId()
    response.setHeader(REQUEST_ID_HEADER, requestId)

    return next.handle().pipe(
      map((data) => ({ ok: true, data: data ?? null, error: null })),
    )
  }
}
