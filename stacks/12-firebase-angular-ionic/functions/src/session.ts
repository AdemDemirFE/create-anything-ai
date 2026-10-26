/**
 * Cookie-backed server-side sessions for Stack 12.
 *
 * Design (PRD §6 Login): Firebase Auth mints the ID token via the emulator's
 * identitytoolkit endpoint; the server verifies it server-side with
 * admin.verifyIdToken and then issues its OWN HttpOnly SameSite=Lax session
 * cookie holding a CSPRNG token whose SHA-256 digest is stored in Firestore
 * with a sliding TTL. Browsers never receive the ID token; revocation is a
 * Firestore delete (server-side session list, not just client state).
 *
 * Session lifetime, revocation and CSRF posture are documented in
 * ARCHITECTURE.md §3.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { Request, Response } from 'express'
import { getFirestore } from 'firebase-admin/firestore'
import { ApiError } from './envelope.js'
import { ErrorCodes } from './error-codes.js'
import { COLLECTIONS, config } from './config.js'
import type { SessionUser } from './types.js'

export type { SessionUser }

export const SESSION_COOKIE_NAME = 'stack12_session'

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: config.secureCookies,
    path: '/',
    maxAge: config.sessionTtlMinutes * 60_000,
  }
}

/**
 * Verify the freshly minted emulator ID token server-side, then issue the
 * opaque session cookie. Login (and only login) calls this.
 */
export async function establishSession(res: Response, idToken: string): Promise<SessionUser> {
  const decoded = await verifyIdToken(idToken)
  const profileSnap = await getFirestore().collection(COLLECTIONS.users).doc(decoded.uid).get()
  if (!profileSnap.exists) throw new ApiError(401, ErrorCodes.Unauthorized, 'Session invalid.')
  const profile = profileSnap.data() as { email?: string; displayName?: string | null }
  const user: SessionUser = {
    uid: decoded.uid,
    email: profile.email ?? decoded.email ?? '',
    displayName: profile.displayName ?? null,
  }

  const token = randomBytes(32).toString('hex')
  const now = Date.now()
  const expiresAt = now + config.sessionTtlMinutes * 60_000
  await getFirestore()
    .collection(COLLECTIONS.sessions)
    .doc(hashToken(token))
    .set({
      uid: user.uid,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(expiresAt).toISOString(),
    })

  res.cookie(SESSION_COOKIE_NAME, token, cookieOptions())
  return user
}

async function verifyIdToken(idToken: string): Promise<{ uid: string; email?: string }> {
  // firebase-admin verifies against the emulator (FIREBASE_AUTH_EMULATOR_HOST
  // set by the test harness) and checks revocation. Imported lazily so unit
  // tests that never touch auth can import this module safely.
  const { getAuth } = await import('firebase-admin/auth')
  const decoded = await getAuth().verifyIdToken(idToken, true)
  return { uid: decoded.uid, email: decoded.email }
}

/**
 * Resolve the session from the cookie. Sliding expiry: a valid session is
 * re-anchored to now + TTL on every successful resolution. Expired sessions
 * are rejected even if the TTL sweep has not run.
 */
export async function resolveSession(req: Request): Promise<SessionUser> {
  const token = req.cookies?.[SESSION_COOKIE_NAME]
  if (typeof token !== 'string' || token.length === 0 || !/^[0-9a-f]{64}$/.test(token)) {
    throw new ApiError(401, ErrorCodes.Unauthorized, 'Authentication required.')
  }
  const digest = hashToken(token)
  const ref = getFirestore().collection(COLLECTIONS.sessions).doc(digest)
  const snap = await ref.get()
  if (!snap.exists) throw new ApiError(401, ErrorCodes.Unauthorized, 'Authentication required.')
  const data = snap.data() as { uid?: string; expiresAt?: string }
  const expiresAtMs = data.expiresAt ? Date.parse(data.expiresAt) : Number.NaN
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
    await ref.delete().catch(() => undefined)
    throw new ApiError(401, ErrorCodes.Unauthorized, 'Authentication required.')
  }
  if (data.uid === undefined) throw new ApiError(401, ErrorCodes.Unauthorized, 'Authentication required.')

  // Sliding re-anchor (no await needed for correctness of this response).
  void ref
    .set(
      { expiresAt: new Date(Date.now() + config.sessionTtlMinutes * 60_000).toISOString() },
      { merge: true },
    )
    .catch(() => undefined)

  const profileSnap = await getFirestore().collection(COLLECTIONS.users).doc(data.uid).get()
  if (!profileSnap.exists) throw new ApiError(401, ErrorCodes.Unauthorized, 'Authentication required.')
  const profile = profileSnap.data() as { email?: string; displayName?: string | null }
  return { uid: data.uid, email: profile.email ?? '', displayName: profile.displayName ?? null }
}

/** Destroy the presented session (logout). Idempotent. */
export async function destroySession(req: Request, res: Response): Promise<void> {
  const token = req.cookies?.[SESSION_COOKIE_NAME]
  res.clearCookie(SESSION_COOKIE_NAME, { path: '/' })
  if (typeof token === 'string' && /^[0-9a-f]{64}$/.test(token)) {
    await getFirestore().collection(COLLECTIONS.sessions).doc(hashToken(token)).delete().catch(() => undefined)
  }
}

/** Constant-time byte compare (kept for parity with stack-19 patterns). */
export function digestEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}
