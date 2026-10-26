/**
 * Auth identity mapping — Stack 12.
 *
 * PRD §6 for a BaaS stack: the managed identity provider owns credential
 * storage and hashing (Firebase Auth emulator performs the same scrypt
 * verification locally; we never see or log password material).
 *
 * Two hard rules implemented here:
 *  1. normalize-before-unique (rule 5): the wire email is trimmed and
 *     lower-cased before it reaches the uniqueness path, so `Ada@Example.com`
 *     and `ada@example.com` are the same account — uniqueness is enforced on
 *     the normalized form (atomic Firestore key create), never the raw one.
 *  2. no account-enumeration: register-existing and login-wrong-password
 *     produce indistinguishable generic messages.
 */
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { ApiError } from './envelope.js'
import { ErrorCodes } from './error-codes.js'
import { COLLECTIONS, config } from './config.js'

/** Trim + lower-case; the ONLY form used for identity and uniqueness. */
export function normalizeEmail(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw.trim().toLowerCase()
}

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/

export function assertValidEmail(raw: unknown): string {
  const email = normalizeEmail(raw)
  if (typeof raw !== 'string' || email.length === 0 || email.length > config.bounds.maxEmailLength || !EMAIL_RE.test(email)) {
    throw new ApiError(422, ErrorCodes.Validation, 'A valid email address is required.')
  }
  return email
}

export function assertValidPassword(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length < 8 || raw.length > config.bounds.maxPasswordLength) {
    throw new ApiError(422, ErrorCodes.Validation, 'Password must be between 8 and 128 characters.')
  }
  return raw
}

/** Generic messages — identical across all rejection reasons per flow. */
export const REGISTER_GENERIC = 'Registration failed.'
export const LOGIN_GENERIC = 'Invalid email or password.'

export interface PublicUser {
  uid: string
  email: string
  displayName: string | null
}

/**
 * Create the Auth user + profile doc. Uniqueness is enforced by an atomic
 * Firestore key create (create() throws ALREADY_EXISTS); on key conflict the
 * just-created Auth user is deleted so the two stores agree. Both failure
 * paths return the same generic message (no enumeration).
 */
export async function registerUser(
  emailRaw: unknown,
  passwordRaw: unknown,
  displayNameRaw: unknown,
): Promise<PublicUser> {
  const email = assertValidEmail(emailRaw)
  const password = assertValidPassword(passwordRaw)
  const displayName =
    typeof displayNameRaw === 'string' && displayNameRaw.trim() !== ''
      ? displayNameRaw.trim().slice(0, 100)
      : null

  const db = getFirestore()
  const uniqueRef = db
    .collection(COLLECTIONS.users)
    .doc('byEmail')
    .collection('keys')
    .doc(normalizeEmail(email))

  let record
  try {
    record = await getAuth().createUser({
      email,
      password,
      displayName: displayName ?? undefined,
    })
  } catch {
    throw new ApiError(409, ErrorCodes.Conflict, REGISTER_GENERIC)
  }

  try {
    await uniqueRef.create({ uid: record.uid, createdAt: new Date().toISOString() })
  } catch {
    await getAuth().deleteUser(record.uid).catch(() => undefined)
    throw new ApiError(409, ErrorCodes.Conflict, REGISTER_GENERIC)
  }

  await db.collection(COLLECTIONS.users).doc(record.uid).set({
    email,
    displayName,
    createdAt: new Date().toISOString(),
  })

  return { uid: record.uid, email, displayName }
}

/**
 * Verify credentials against the Auth emulator via the identitytoolkit REST
 * endpoint the emulator implements (same wire API as production). Returns
 * the verified uid/email or throws the generic INVALID_CREDENTIALS error.
 * Password material is only ever sent over the loopback to the emulator.
 */
export async function verifyCredentials(email: string, password: string): Promise<{ uid: string; idToken: string }> {
  const apiKey = process.env.FIREBASE_API_KEY ?? 'fake-api-key'
  const url = `http://${config.authEmulatorHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  })
  const body = (await res.json().catch(() => ({}))) as {
    localId?: string
    idToken?: string
  }
  if (!res.ok || !body.localId || !body.idToken) {
    throw new ApiError(401, ErrorCodes.InvalidCredentials, LOGIN_GENERIC)
  }
  return { uid: body.localId, idToken: body.idToken }
}

/** Load the public profile for a uid (profile doc is the source of truth). */
export async function loadPublicUser(uid: string): Promise<PublicUser> {
  const snap = await getFirestore().collection(COLLECTIONS.users).doc(uid).get()
  if (!snap.exists) throw new ApiError(401, ErrorCodes.Unauthorized, 'Session invalid.')
  const data = snap.data() as { email?: string; displayName?: string | null }
  return { uid, email: data.email ?? '', displayName: data.displayName ?? null }
}
