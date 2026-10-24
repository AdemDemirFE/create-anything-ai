/**
 * Cookie-backed server-side sessions stored in MongoDB.
 *
 * - Token: 32 bytes from the OS CSPRNG, hex-encoded. Only its SHA-256 digest
 *   is persisted, so a database read cannot resurrect a live session.
 * - Cookie: HttpOnly, SameSite=Lax, Path=/; Secure when configured. Lifetime
 *   equals the sliding session TTL.
 * - Sliding (idle) expiry: every successful resolution re-anchors
 *   `expiresAt` to now + TTL. Expired sessions are never honored even if the
 *   TTL sweep has not reached them yet.
 * - Login always mints a FRESH token (session fixation defense); logout
 *   deletes the server-side row and clears the cookie.
 */
import { createHash, randomBytes } from 'node:crypto'
import type { Request, Response } from 'express'
import type { HydratedDocument } from 'mongoose'
import { User, Session, type SessionDoc, type UserDoc } from '../models.js'

type SessionModelDoc = HydratedDocument<SessionDoc>

export const SESSION_COOKIE_NAME = 'stack18_session'

export interface SessionConfig {
  ttlMinutes: number
  secureCookies: boolean
}

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

function cookieOptions(config: SessionConfig): {
  httpOnly: true
  sameSite: 'lax'
  secure: boolean
  path: '/'
  maxAge: number
} {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.secureCookies,
    path: '/',
    maxAge: config.ttlMinutes * 60 * 1000,
  }
}

export function readSessionToken(req: Request): string | undefined {
  const token = req.cookies?.[SESSION_COOKIE_NAME]
  return typeof token === 'string' && token.length > 0 ? token : undefined
}

export function attachSessionCookie(res: Response, token: string, config: SessionConfig): void {
  res.cookie(SESSION_COOKIE_NAME, token, cookieOptions(config))
}

export function clearSessionCookie(res: Response, config: SessionConfig): void {
  const { maxAge: _ignoredMaxAge, ...clearOptions } = cookieOptions(config)
  // Note: maxAge is deliberately omitted on clearCookie (Express deprecation
  // warning in 4.x; expiry is implied for deletions).
  res.clearCookie(SESSION_COOKIE_NAME, clearOptions)
}

export async function createSession(user: UserDoc, config: SessionConfig): Promise<string> {
  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + config.ttlMinutes * 60 * 1000)
  await Session.create({ tokenHash: hashToken(token), userId: user._id, expiresAt })
  return token
}

export async function destroySession(req: Request, res: Response, config: SessionConfig): Promise<void> {
  const token = readSessionToken(req)
  if (token) {
    await Session.deleteOne({ tokenHash: hashToken(token) })
  }
  clearSessionCookie(res, config)
}

/**
 * Resolves the authenticated user for a request. Returns null when the
 * cookie is missing, the session is unknown/expired, or the user is gone.
 * Successfully resolving a live session slides its expiry forward.
 */
export async function currentUser(
  req: Request,
  config: SessionConfig,
): Promise<UserDoc | null> {
  const token = readSessionToken(req)
  if (!token) return null
  const session: SessionModelDoc | null = await Session.findOne({ tokenHash: hashToken(token) })
  if (!session) return null
  if (session.expiresAt.getTime() <= Date.now()) {
    await Session.deleteOne({ _id: session._id })
    return null
  }
  const user: UserDoc | null = await User.findById(session.userId)
  if (!user) return null
  session.expiresAt = new Date(Date.now() + config.ttlMinutes * 60 * 1000)
  await session.save()
  return user
}
