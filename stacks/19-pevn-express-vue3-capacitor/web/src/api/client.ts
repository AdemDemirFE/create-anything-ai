/**
 * Web-side singleton of the SHARED API client. The Capacitor shell builds
 * its own instance with a mobile base URL — the request building and
 * envelope handling still come from the same shared module.
 */
import { ApiClient } from '@shared/api-client'

export const api = new ApiClient({ baseUrl: '/api/v1' })
export { ApiError } from '@shared/envelope'
export type { DocumentDto, DocumentListData, HomeData, AlgorithmInfo, AlgorithmRunResult, PublicUser } from '@shared/api-client'
