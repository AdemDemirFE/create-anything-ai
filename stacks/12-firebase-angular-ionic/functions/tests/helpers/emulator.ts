/**
 * Emulator test harness — Stack 12.
 *
 * Boots the REAL Firebase Auth (9099) + Firestore (8088) emulators once via
 * `firebase emulators:exec` (see package.json test:emulator script), then:
 *   - points firebase-admin at both emulators (FIREBASE_AUTH_EMULATOR_HOST /
 *     FIRESTORE_EMULATOR_HOST are set by the exec environment),
 *   - drives the SAME Express app that production wraps in onRequest v2 with
 *     supertest — the wire contract is identical,
 *   - wipes emulator state between tests (emulator-only REST endpoints).
 *
 * No production Firebase project is touched (production UNVERIFIED).
 */
import { beforeEach } from 'vitest'
import type { Express } from 'express'
// Static import: vitest resolves the TS source directly (no build step), so
// the test suite always exercises the real createApp implementation.
import { createApp } from '../../src/app'
import { COLLECTIONS } from '../../src/config'
import { resetThrottle } from '../../src/throttle'

/** Must match the .firebaserc default — the emulator runs in singleProjectMode. */
export const TEST_PROJECT_ID = 'stack12-demo'

let appPromise: Promise<Express> | null = null

async function loadApp(): Promise<Express> {
  const admin = await import('firebase-admin')
  const { initializeApp } = await import('firebase-admin/app')

  if (admin.apps.length === 0) {
    initializeApp({ projectId: TEST_PROJECT_ID })
  }
  return createApp()
}

/** Wire admin to the emulators (idempotent) and return the app. */
export async function setupEmulatorTest(): Promise<Express> {
  if (!appPromise) appPromise = loadApp()
  return appPromise
}

/**
 * Clear ALL emulator state:
 *  - Auth: emulator admin API (Authorization: Bearer owner is the emulator's
 *    documented owner-credential shortcut): batchGet lists every account,
 *    batchDelete removes them in one call.
 *  - Firestore: admin SDK deletes every doc in every collection.
 */
export async function clearEmulatorState(): Promise<void> {
  const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST
  if (!authHost) {
    throw new Error('FIREBASE_AUTH_EMULATOR_HOST is not set — are the emulators running? (npm run test:emulator)')
  }
  const ownerHeaders = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }

  // --- Auth: batchGet then batchDelete (emulator admin API) ------------------
  const listRes = await fetch(
    `http://${authHost}/identitytoolkit.googleapis.com/v1/projects/${TEST_PROJECT_ID}/accounts:batchGet`,
    { headers: ownerHeaders },
  )
  if (listRes.ok) {
    const listBody = (await listRes.json().catch(() => ({}))) as { users?: Array<{ localId: string }> }
    const localIds = (listBody.users ?? []).map((u) => u.localId)
    if (localIds.length > 0) {
      await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/projects/${TEST_PROJECT_ID}/accounts:batchDelete`, {
        method: 'POST',
        headers: ownerHeaders,
        body: JSON.stringify({ localIds, force: true }),
      })
    }
  }

  // --- Firestore: delete every document in every collection ------------------
  const admin = await import('firebase-admin')
  const firestore = admin.firestore()
  const collections = await firestore.listCollections()
  for (const c of collections) {
    await deleteCollectionTree(firestore, c.path)
  }
  // Path-prefix subcollections are NOT reachable from listCollections():
  // `users/byEmail` is a path prefix (never a document), so the tree walk
  // above cannot see `users/byEmail/keys/{email}`. Delete the keyed
  // uniqueness collection explicitly or register-after-clear returns 409
  // forever (stale uniqueness keys leaking across tests).
  await deleteCollectionTree(firestore, `${COLLECTIONS.users}/byEmail/keys`)
}

async function deleteCollectionTree(firestore: import('firebase-admin/firestore').Firestore, path: string): Promise<void> {
  const snap = await firestore.collection(path).limit(500).get()
  if (snap.empty) return
  const batch = firestore.batch()
  const subPaths = new Set<string>()
  for (const d of snap.docs) {
    batch.delete(d.ref)
    const subs = await d.ref.listCollections()
    for (const s of subs) subPaths.add(s.path)
  }
  await batch.commit()
  for (const sub of subPaths) {
    await deleteCollectionTree(firestore, sub)
  }
}

/**
 * Hooks for a test file that needs the emulators. Initializes the app once
 * per file (beforeAll at import time is avoided; each file calls this) and
 * clears state before every test.
 *
 * Usage in a test file:
 *   const { getApp } = emulatorSuite()
 *   ... beforeAll(() => { app = ... }) or call getApp() lazily.
 */
export function emulatorSuite(): { getApp: () => Express } {
  let app: Express | null = null

  const ensure = async (): Promise<Express> => {
    if (!app) app = await setupEmulatorTest()
    return app
  }

  beforeEach(async () => {
    await ensure()
    // App-side in-memory state: the throttle windows Map is module-level and
    // lives in this same process, so failed logins from earlier tests would
    // otherwise leak into later windows (429 cascades).
    resetThrottle()
    await clearEmulatorState()
  })

  return {
    getApp: () => {
      if (!app) throw new Error('emulator suite not initialized (beforeAll pending)')
      return app
    },
  }
}

/** Delete the firebase-admin app so vitest can exit cleanly. */
export async function teardownEmulatorTest(): Promise<void> {
  const admin = await import('firebase-admin')
  await Promise.all(admin.apps.map((a) => a?.delete()))
  appPromise = null
}
