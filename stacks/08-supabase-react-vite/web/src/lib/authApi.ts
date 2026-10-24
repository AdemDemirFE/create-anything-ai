/**
 * Auth data access (stack 08). Wraps supabase-js auth and normalizes every
 * result into the client-side envelope (see envelope.ts). Pages never touch
 * the Supabase client directly.
 *
 * Security notes mapped from PRD §6:
 * - register surfaces EMAIL_TAKEN (Supabase's own behavior); the demo UI copy
 *   avoids claiming whether an account exists beyond what GoTrue returns.
 * - login uses GoTrue's generic `invalid_credentials` for unknown users and
 *   wrong passwords alike — no enumeration defense to implement client-side.
 * - session lifetime/refresh are GoTrue JWTs (default 1h access token with
 *   rotating refresh tokens, autoRefreshToken enabled in supabase.ts); the
 *   token is stored in localStorage by supabase-js (browser-appropriate for
 *   this reference; a production build would consider secure storage).
 * - logout revokes the GoTrue session server-side and clears local storage.
 */

import type { Session, User } from '@supabase/supabase-js'
import { getSupabaseClient } from './supabase'
import {
  ErrorCodes,
  failureEnvelope,
  friendlyMessage,
  generateRequestId,
  mapAuthErrorCode,
  mapPostgrestErrorCode,
  successEnvelope,
  type Envelope,
} from './envelope'

export interface AuthResult {
  user: User
  session: Session
}

function authErrorEnvelope(err: unknown): Envelope<never> {
  const requestId = generateRequestId()
  const anyErr = err as { code?: unknown; status?: unknown; message?: unknown; name?: unknown }
  const status = typeof anyErr?.status === 'number' ? anyErr.status : 0
  const name = typeof anyErr?.name === 'string' ? anyErr.name : ''

  // Network-level failures (fetch rejected / retryable) must not masquerade
  // as credential problems.
  if (name === 'AuthRetryableFetchError') {
    return failureEnvelope(
      { code: ErrorCodes.Network, message: friendlyMessage(ErrorCodes.Network), status },
      requestId,
    )
  }
  if (name === 'AuthWeakPasswordError') {
    return failureEnvelope(
      { code: ErrorCodes.WeakPassword, message: friendlyMessage(ErrorCodes.WeakPassword), status },
      requestId,
    )
  }
  // AuthApiError carries the GoTrue error code (e.g. invalid_credentials,
  // email_exists) directly on `.code`; map it to the stable envelope code.
  const providerCode = typeof anyErr?.code === 'string' ? anyErr.code : undefined
  const code = providerCode ? mapAuthErrorCode(providerCode) : ErrorCodes.Unknown
  return failureEnvelope({ code, message: friendlyMessage(code), status }, requestId)
}

export function isEmailValid(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export function isPasswordValid(password: string): boolean {
  // 8+ chars, at least one letter and one digit — mirrors the UI hint; GoTrue
  // enforces the project's actual policy and weak_password maps accordingly.
  return password.length >= 8 && /[A-Za-z]/.test(password) && /\d/.test(password)
}

function validationFailure(field: 'email' | 'password', requestId?: string): Envelope<never> {
  const code = ErrorCodes.Validation
  const message =
    field === 'email' ? 'Enter a valid email address.' : friendlyMessage(ErrorCodes.WeakPassword)
  return failureEnvelope({ code, message, status: 0 }, requestId)
}

export async function register(email: string, password: string): Promise<Envelope<AuthResult>> {
  if (!isEmailValid(email)) return validationFailure('email')
  if (!isPasswordValid(password)) return validationFailure('password')
  try {
    const { data, error } = await getSupabaseClient().auth.signUp({ email, password })
    if (error) return authErrorEnvelope(error) as Envelope<AuthResult>
    if (!data.session || !data.user) {
      // Email confirmation enabled => no session yet. The local config.toml
      // disables confirmation, so this is a configuration surprise, not a
      // user error.
      return failureEnvelope(
        {
          code: ErrorCodes.Validation,
          message: 'Check your inbox to confirm the account before signing in.',
          status: 0,
        },
        generateRequestId(),
      ) as Envelope<AuthResult>
    }
    return successEnvelope({ user: data.user, session: data.session }, generateRequestId())
  } catch (err) {
    return authErrorEnvelope(err) as Envelope<AuthResult>
  }
}

export async function login(email: string, password: string): Promise<Envelope<AuthResult>> {
  if (!isEmailValid(email)) return validationFailure('email')
  if (!password) return validationFailure('password')
  try {
    const { data, error } = await getSupabaseClient().auth.signInWithPassword({ email, password })
    if (error) return authErrorEnvelope(error) as Envelope<AuthResult>
    if (!data.session || !data.user) {
      return failureEnvelope(
        {
          code: ErrorCodes.InvalidCredentials,
          message: friendlyMessage(ErrorCodes.InvalidCredentials),
          status: 0,
        },
        generateRequestId(),
      ) as Envelope<AuthResult>
    }
    return successEnvelope({ user: data.user, session: data.session }, generateRequestId())
  } catch (err) {
    return authErrorEnvelope(err) as Envelope<AuthResult>
  }
}

export async function logout(): Promise<Envelope<null>> {
  try {
    const { error } = await getSupabaseClient().auth.signOut()
    if (error) {
      // signOut already cleared local state for 401/403/404 (see auth-js);
      // anything else is reported but the local session is gone regardless.
      return authErrorEnvelope(error) as Envelope<null>
    }
    return successEnvelope(null, generateRequestId())
  } catch (err) {
    return authErrorEnvelope(err) as Envelope<null>
  }
}

export async function getSession(): Promise<Envelope<Session | null>> {
  try {
    const { data, error } = await getSupabaseClient().auth.getSession()
    if (error) return authErrorEnvelope(error) as Envelope<Session | null>
    return successEnvelope(data.session ?? null, generateRequestId())
  } catch (err) {
    return authErrorEnvelope(err) as Envelope<Session | null>
  }
}

export interface AuthUserView {
  id: string
  email: string
}

export function toUserView(user: User): AuthUserView {
  return { id: user.id, email: user.email ?? '(no email)' }
}

// Re-exported for the data layer and tests.
export { mapPostgrestErrorCode }
