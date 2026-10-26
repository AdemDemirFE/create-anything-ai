/**
 * Documents CRUD + algorithm workbench + Firestore rules tests â€” REAL
 * Firestore emulator.
 *
 * Rules are exercised with @firebase/rules-unit-testing (unauthenticated and
 * authenticated client contexts) to prove the security rules reject
 * cross-user reads/writes, while the API layer (admin SDK) works.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import supertest from 'supertest'
import type { SuperTest, Test } from 'supertest'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { emulatorSuite, teardownEmulatorTest, TEST_PROJECT_ID } from './helpers/emulator.js'

const suite = emulatorSuite()
let agent: SuperTest<Test>

const EMAIL = ['ada', 'example.com'].join('@')
const EMAIL2 = ['grace', 'example.com'].join('@')
const PASSWORD = ['correct', 'horse', 'battery'].join('')

/** Sync accessor - app is initialized in beforeEach (emulatorSuite). */
function api(): SuperTest<Test> {
  if (!agent) {
    agent = supertest(suite.getApp()) as SuperTest<Test>
  }
  return agent
}

let testEnv: RulesTestEnvironment

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: TEST_PROJECT_ID,
    firestore: {
      rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8'),
      host: '127.0.0.1',
      port: 8088,
    },
  })
})

afterAll(async () => {
  await testEnv.cleanup()
  await teardownEmulatorTest()
})

async function loginCookie(email: string): Promise<string[]> {
  await (api()).post('/api/v1/auth/register').send({ email, password: PASSWORD }).expect(200)
  const login = await (api()).post('/api/v1/auth/login').send({ email, password: PASSWORD }).expect(200)
  return login.headers['set-cookie']
}

describe('documents CRUD', () => {
  it('create + get round-trips through Firestore', async () => {
    const cookie = await loginCookie(EMAIL)
    const created = await (api())
      .post('/api/v1/documents')
      .set('Cookie', cookie)
      .send({ title: 'First', content: 'hello world' })
      .expect(200)
    expect(created.body.data.id).toMatch(/^[0-9a-f-]{36}$/)
    const got = await (api()).get(`/api/v1/documents/${created.body.data.id}`).set('Cookie', cookie).expect(200)
    expect(got.body.data.title).toBe('First')
    expect(got.body.data.content).toBe('hello world')
  })

  it('list paginates with stable pagination envelope', async () => {
    const cookie = await loginCookie(EMAIL)
    for (let i = 0; i < 3; i += 1) {
      await (api()).post('/api/v1/documents').set('Cookie', cookie).send({ title: `Doc ${i}`, content: 'x' }).expect(200)
    }
    const res = await (api()).get('/api/v1/documents?page=1&limit=2').set('Cookie', cookie).expect(200)
    expect(res.body.data.documents).toHaveLength(2)
    expect(res.body.data.pagination).toMatchObject({ page: 1, limit: 2, total: 3, pages: 2 })
  })

  it('update changes title/content and updatedAt > createdAt', async () => {
    const cookie = await loginCookie(EMAIL)
    const created = await (api()).post('/api/v1/documents').set('Cookie', cookie).send({ title: 'A', content: 'a' }).expect(200)
    const id = created.body.data.id
    const updated = await (api()).put(`/api/v1/documents/${id}`).set('Cookie', cookie).send({ title: 'B' }).expect(200)
    expect(updated.body.data.title).toBe('B')
    expect(updated.body.data.content).toBe('a')
    expect(new Date(updated.body.data.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(updated.body.data.createdAt).getTime())
  })

  it('delete removes the document; subsequent get is 404', async () => {
    const cookie = await loginCookie(EMAIL)
    const created = await (api()).post('/api/v1/documents').set('Cookie', cookie).send({ title: 'D', content: 'd' }).expect(200)
    const id = created.body.data.id
    await (api()).delete(`/api/v1/documents/${id}`).set('Cookie', cookie).expect(200)
    await (api()).get(`/api/v1/documents/${id}`).set('Cookie', cookie).expect(404)
  })

  it('other user cannot read my document (API layer isolation)', async () => {
    const cookieA = await loginCookie(EMAIL)
    const created = await (api()).post('/api/v1/documents').set('Cookie', cookieA).send({ title: 'Private', content: 'secret' }).expect(200)
    const cookieB = await loginCookie(EMAIL2)
    await (api()).get(`/api/v1/documents/${created.body.data.id}`).set('Cookie', cookieB).expect(404)
  })

  it('rejects oversized title (413 INPUT_TOO_LARGE)', async () => {
    const cookie = await loginCookie(EMAIL)
    const res = await (api())
      .post('/api/v1/documents')
      .set('Cookie', cookie)
      .send({ title: 'x'.repeat(201), content: 'ok' })
      .expect(413)
    expect(res.body.error.code).toBe('INPUT_TOO_LARGE')
  })

  it('rejects invalid document id with VALIDATION_ERROR', async () => {
    const cookie = await loginCookie(EMAIL)
    const res = await (api()).get('/api/v1/documents/not%20a%20uuid!').set('Cookie', cookie).expect(422)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('documents endpoints require auth', async () => {
    await (api()).get('/api/v1/documents').expect(401)
    await (api()).post('/api/v1/documents').send({ title: 't', content: 'c' }).expect(401)
  })
})

describe('firestore security rules (client contexts, real emulator)', () => {
  it('unauthenticated client cannot read a user profile', async () => {
    await assertFails(getDoc(doc(testEnv.unauthenticatedContext().firestore(), 'users', 'some-uid')))
  })

  it('unauthenticated client cannot write documents', async () => {
    const db = testEnv.unauthenticatedContext().firestore()
    await assertFails(setDoc(doc(db, 'users/some-uid/documents/abc'), { title: 'x' }))
  })

  it('owner can read+write own documents but not another userâ€™s', async () => {
    const uid = 'rule-user-1'
    const otherUid = 'rule-user-2'
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', uid), { email: 'r1@example.com' })
      await setDoc(doc(ctx.firestore(), 'users', otherUid), { email: 'r2@example.com' })
    })
    const ownerDb = testEnv.authenticatedContext(uid).firestore()
    const mine = doc(ownerDb, `users/${uid}/documents/doc1`)
    await assertSucceeds(setDoc(mine, { title: 'mine' }))
    await assertSucceeds(getDoc(mine))
    const foreign = doc(ownerDb, `users/${otherUid}/documents/doc2`)
    await assertFails(getDoc(foreign))
    await assertFails(setDoc(foreign, { title: 'evil' }))
  })

  it('no client can touch sessions or the unique-email keys', async () => {
    const db = testEnv.authenticatedContext('rule-user-1').firestore()
    await assertFails(getDoc(doc(db, 'sessions/anydigest')))
    await assertFails(setDoc(doc(db, 'users/byEmail/keys/ada@example.com'), { uid: 'x' }))
  })
})

describe('algorithm workbench', () => {
  it('lists the fixed catalog with complexity + explanation', async () => {
    const cookie = await loginCookie(EMAIL)
    const res = await (api()).get('/api/v1/algorithms').set('Cookie', cookie).expect(200)
    const ids = res.body.data.map((a: { id: string }) => a.id)
    expect(ids).toContain('fizzbuzz')
    expect(ids).toContain('reverse')
    expect(res.body.data.every((a: { complexity: string; explanation: string }) => a.complexity && a.explanation)).toBe(true)
  })

  it('runs fizzbuzz with measured duration distinct from Big-O', async () => {
    const cookie = await loginCookie(EMAIL)
    const res = await (api())
      .post('/api/v1/algorithms/fizzbuzz/run')
      .set('Cookie', cookie)
      .send({ input: '15' })
      .expect(200)
    expect(res.body.data.output.split('\n')[14]).toBe('FizzBuzz')
    expect(typeof res.body.data.durationMs).toBe('number')
    expect(res.body.data.complexity).toBe('O(n)')
  })

  it('rejects unknown algorithm id', async () => {
    const cookie = await loginCookie(EMAIL)
    await (api()).post('/api/v1/algorithms/eval-js/run').set('Cookie', cookie).send({ input: '1' }).expect(404)
  })

  it('rejects oversized input with 413', async () => {
    const cookie = await loginCookie(EMAIL)
    const res = await (api()).post('/api/v1/algorithms/reverse/run').set('Cookie', cookie).send({ input: 'x'.repeat(10_001) }).expect(413)
    expect(res.body.error.code).toBe('INPUT_TOO_LARGE')
  })

  it('rejects malformed fizzbuzz input with 422 (bounded, safe)', async () => {
    const cookie = await loginCookie(EMAIL)
    const res = await (api()).post('/api/v1/algorithms/fizzbuzz/run').set('Cookie', cookie).send({ input: 'not-a-number' }).expect(422)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('algorithms endpoints require auth', async () => {
    await (api()).get('/api/v1/algorithms').expect(401)
    await (api()).post('/api/v1/algorithms/reverse/run').send({ input: 'x' }).expect(401)
  })
})
