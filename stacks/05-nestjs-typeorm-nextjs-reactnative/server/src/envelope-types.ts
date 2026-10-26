/** Wire shape of error details (mirrors ../shared/src/envelope.ts). */
export interface ErrorDetail {
  field: string
  code: string
  message: string
}

export interface ApiErrorBody {
  code: string
  message: string
  details?: ErrorDetail[]
}

export interface Envelope<T = unknown> {
  ok: boolean
  data: T | null
  error: ApiErrorBody | null
}

/** Opaque correlation id — contract: [A-Za-z0-9-]{1,64}. */
export const REQUEST_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-'

/** CSPRNG request id in the contract shape. */
export function newRequestId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  let out = ''
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length]
  return out
}
