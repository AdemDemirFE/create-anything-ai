/**
 * Stack 05 web API surface: a browser ApiClient over the shared layer.
 * Same-origin via the Next.js rewrite (`/api/v1/...` to the API origin), so
 * the HttpOnly session cookie stays first-party.
 */
'use client'

import { ApiClient } from '@shared/api-client'

export const api = new ApiClient({ baseUrl: '/api/v1', credentials: 'same-origin' })
export { ApiError } from '@shared/envelope'
export type { Envelope, ApiErrorBody, ErrorDetail } from '@shared/envelope'
export type {
  PublicUser,
  HomeData,
  AlgorithmInfo,
  AlgorithmRunResult,
  DocumentDto,
  DocumentListData,
} from '@shared/api-client'
