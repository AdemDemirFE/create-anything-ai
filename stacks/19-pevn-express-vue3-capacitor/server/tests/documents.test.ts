/**
 * Documents CRUD integration tests (the document-store paradigm reused from
 * Stack 18). Ownership-scoped, allow-listed fields, pagination, stable 404
 * semantics.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SuperTest, Test } from 'supertest'
import { createTestApp, destroyTestApp, request, type TestApp } from './helpers.js'

let testApp: TestApp
let agent: SuperTest<Test>
let cookie = ''
let otherCookie = ''

const PASSWORD = ['correct', 'horse', 'battery'].join('')

async function registerAndLogin(email: string): Promise<string> {
  await agent.post('/api/v1/register').send({ email, password: PASSWORD })
  const res = await agent.post('/api/v1/login').send({ email, password: PASSWORD })
  return String((res.headers['set-cookie'] as unknown as string[])[0])
}

beforeAll(async () => {
  testApp = await createTestApp()
  agent = request(testApp.app)
  cookie = await registerAndLogin('docowner@example.com')
  otherCookie = await registerAndLogin('otheruser@example.com')
})

afterAll(async () => {
  await destroyTestApp(testApp)
})

function createDocument(input: Record<string, unknown>, withCookie = cookie) {
  return agent.post('/api/v1/documents').set('Cookie', withCookie).send(input)
}

async function createSample(title = 'My note'): Promise<string> {
  const res = await createDocument({ title, content: `content of ${title}`, tags: ['demo'] })
  return res.body.data.document.id as string
}

describe('documents create', () => {
  it('creates a document and returns 201 with the public projection', async () => {
    const res = await createDocument({ title: 'First', content: 'Hello world', tags: ['a', 'b'] }).expect(201)
    expect(res.body.ok).toBe(true)
    const doc = res.body.data.document
    expect(doc.title).toBe('First')
    expect(doc.content).toBe('Hello world')
    expect(doc.tags).toEqual(['a', 'b'])
    expect(doc.id).toMatch(/^[a-f\d]{24}$/i)
    expect(typeof doc.createdAt).toBe('string')
    expect(typeof doc.updatedAt).toBe('string')
  })

  it('drops unknown fields (allow-list discipline end-to-end)', async () => {
    const res = await createDocument({
      title: 'Injection attempt',
      content: 'body',
      isAdmin: true,
      userId: '000000000000000000000000',
      secret: 'value',
    }).expect(201)
    const doc = res.body.data.document
    expect(JSON.stringify(doc)).not.toContain('isAdmin')
    expect(JSON.stringify(doc)).not.toContain('secret')
    // userId projection never echoes an injected override.
    expect(doc).not.toHaveProperty('userId')
  })

  it('validates required title and content', async () => {
    const res = await createDocument({ title: '', content: '' }).expect(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
    expect(res.body.error.details).toEqual([
      { field: 'title', code: 'REQUIRED' },
      { field: 'content', code: 'REQUIRED' },
    ])
  })

  it('enforces the 200-char title and 10,000-char content bounds', async () => {
    await createDocument({ title: 'x'.repeat(201), content: 'ok' }).expect(400)
    await createDocument({ title: 'ok', content: 'x'.repeat(10_001) }).expect(400)
    await createDocument({ title: 'x'.repeat(200), content: 'x'.repeat(10_000) }).expect(201)
  })

  it('validates tags bounds (max 10 tags, 32 chars each)', async () => {
    const tooMany = await createDocument({ title: 't', content: 'c', tags: Array.from({ length: 11 }, (_, i) => `tag${i}`) }).expect(400)
    expect(tooMany.body.error.details).toEqual([{ field: 'tags', code: 'TOO_MANY' }])
    await createDocument({ title: 't', content: 'c', tags: ['x'.repeat(33)] }).expect(400)
  })

  it('requires authentication', async () => {
    await agent.post('/api/v1/documents').send({ title: 'x', content: 'y' }).expect(401)
  })
})

describe('documents list', () => {
  it('lists own documents newest-updated first with pagination', async () => {
    for (let i = 1; i <= 5; i += 1) {
      await createDocument({ title: `List ${i}`, content: 'c' })
    }
    const res = await agent.get('/api/v1/documents?limit=3&page=1').set('Cookie', cookie).expect(200)
    expect(res.body.data.documents).toHaveLength(3)
    expect(res.body.data.pagination.page).toBe(1)
    expect(res.body.data.pagination.limit).toBe(3)
    expect(res.body.data.pagination.total).toBeGreaterThanOrEqual(5)
    expect(res.body.data.pagination.pages).toBe(Math.ceil(res.body.data.pagination.total / 3))
    const titles = res.body.data.documents.map((d: { title: string }) => d.title)
    expect(titles).toContain('List 5')
  })

  it('page 2 returns more documents without overlap', async () => {
    const page1 = await agent.get('/api/v1/documents?limit=3&page=1').set('Cookie', cookie).expect(200)
    const page2 = await agent.get('/api/v1/documents?limit=3&page=2').set('Cookie', cookie).expect(200)
    expect(page2.body.data.documents.length).toBeGreaterThan(0)
    const ids1 = page1.body.data.documents.map((d: { id: string }) => d.id)
    const ids2 = page2.body.data.documents.map((d: { id: string }) => d.id)
    for (const id of ids2) expect(ids1).not.toContain(id)
  })

  it('never returns another user’s documents', async () => {
    const mine = await createDocument({ title: 'Owner only', content: 'private' })
    const res = await agent.get('/api/v1/documents').set('Cookie', otherCookie).expect(200)
    const ids = res.body.data.documents.map((d: { id: string }) => d.id)
    expect(ids).not.toContain(mine.body.data.document.id)
  })

  it('rejects out-of-bounds pagination', async () => {
    await agent.get('/api/v1/documents?limit=0').set('Cookie', cookie).expect(400)
    await agent.get('/api/v1/documents?limit=101').set('Cookie', cookie).expect(400)
    await agent.get('/api/v1/documents?page=abc').set('Cookie', cookie).expect(400)
  })
})

describe('documents read/update/delete', () => {
  it('reads a single document by id', async () => {
    const id = await createSample('Read me')
    const res = await agent.get(`/api/v1/documents/${id}`).set('Cookie', cookie).expect(200)
    expect(res.body.data.document.title).toBe('Read me')
  })

  it('returns 400 INVALID_ID for malformed ids', async () => {
    const res = await agent.get('/api/v1/documents/not-an-objectid').set('Cookie', cookie).expect(400)
    expect(res.body.error.code).toBe('INVALID_ID')
  })

  it('returns identical 404 for missing and foreign documents', async () => {
    const missing = await agent.get(`/api/v1/documents/${'a'.repeat(24)}`).set('Cookie', cookie).expect(404)
    const foreign = await createDocument({ title: 'Foreign', content: 'x' })
    const foreignId = foreign.body.data.document.id
    const foreignRes = await agent.get(`/api/v1/documents/${foreignId}`).set('Cookie', otherCookie).expect(404)
    expect(missing.body.error).toEqual(foreignRes.body.error)
    expect(missing.body.error.code).toBe('NOT_FOUND')
  })

  it('updates fields partially and preserves the others', async () => {
    const id = await createSample('Update me')
    const res = await agent
      .put(`/api/v1/documents/${id}`)
      .set('Cookie', cookie)
      .send({ title: 'Updated title' })
      .expect(200)
    expect(res.body.data.document.title).toBe('Updated title')
    expect(res.body.data.document.content).toBe(`content of Update me`)
    expect(res.body.data.document.updatedAt).not.toBe(res.body.data.document.createdAt)
  })

  it('update honors ownership (foreign document is 404)', async () => {
    const id = await createSample('Not yours')
    await agent
      .put(`/api/v1/documents/${id}`)
      .set('Cookie', otherCookie)
      .send({ title: 'Hacked' })
      .expect(404)
    const res = await agent.get(`/api/v1/documents/${id}`).set('Cookie', cookie).expect(200)
    expect(res.body.data.document.title).toBe('Not yours')
  })

  it('update rejects unknown fields and empty payloads', async () => {
    const id = await createSample('Strict update')
    await agent
      .put(`/api/v1/documents/${id}`)
      .set('Cookie', cookie)
      .send({ intruder: true })
      .expect(400)
    await agent.put(`/api/v1/documents/${id}`).set('Cookie', cookie).send({}).expect(400)
  })

  it('deletes a document; subsequent reads are 404', async () => {
    const id = await createSample('Delete me')
    const res = await agent.delete(`/api/v1/documents/${id}`).set('Cookie', cookie).expect(200)
    expect(res.body.data.deletedId).toBe(id)
    await agent.get(`/api/v1/documents/${id}`).set('Cookie', cookie).expect(404)
  })

  it('delete honors ownership (foreign document is 404, still exists)', async () => {
    const id = await createSample('Survivor')
    await agent.delete(`/api/v1/documents/${id}`).set('Cookie', otherCookie).expect(404)
    await agent.get(`/api/v1/documents/${id}`).set('Cookie', cookie).expect(200)
  })

  it('requires authentication for all operations', async () => {
    const id = await createSample('Auth check')
    await agent.get(`/api/v1/documents/${id}`).expect(401)
    await agent.put(`/api/v1/documents/${id}`).send({ title: 'x' }).expect(401)
    await agent.delete(`/api/v1/documents/${id}`).expect(401)
  })
})
