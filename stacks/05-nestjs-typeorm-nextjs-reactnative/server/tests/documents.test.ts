/**
 * Documents CRUD tests: per-user scoping, validation bounds, search with
 * LIKE wildcard literals, pagination and ownership on update/delete.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeTestApp, getTestApp, http, registerUser, cookieHeader } from './helpers.js'

beforeAll(async () => {
  await getTestApp()
})

afterAll(async () => {
  await closeTestApp()
})

async function authed(userIdSeed: string): Promise<{ agent: () => ReturnType<typeof http>; user: Awaited<ReturnType<typeof registerUser>> }> {
  const user = await registerUser()
  void userIdSeed
  return { agent: http, user }
}

describe('documents CRUD', () => {
  it('creates a document with 201 and echo DTO fields', async () => {
    const { agent, user } = await authed('create')
    const response = await agent().post('/api/v1/documents').set('cookie', cookieHeader(user.cookies)).send({
      title: 'Alpha report',
      content: 'first body',
      tags: ['a', 'b'],
    })
    expect(response.status).toBe(201)
    expect(response.body.ok).toBe(true)
    expect(response.body.data.title).toBe('Alpha report')
    expect(response.body.data.tags).toEqual(['a', 'b'])
    expect(typeof response.body.data.id).toBe('number')
  })

  it('lists documents newest-first with pagination metadata', async () => {
    const { agent, user } = await authed('list')
    const cookie = cookieHeader(user.cookies)
    await agent().post('/api/v1/documents').set('cookie', cookie).send({ title: 'One', content: 'x' })
    await agent().post('/api/v1/documents').set('cookie', cookie).send({ title: 'Two', content: 'y' })
    const response = await agent().get('/api/v1/documents?page=1').set('cookie', cookie)
    expect(response.status).toBe(200)
    expect(response.body.data.documents).toHaveLength(2)
    expect(response.body.data.pagination).toMatchObject({ page: 1, limit: 20, total: 2, pages: 1 })
    expect(response.body.data.documents[0].title).toBe('Two')
  })

  it('search treats LIKE wildcards in the USER term as literals', async () => {
    const { agent, user } = await authed('wildcard')
    const cookie = cookieHeader(user.cookies)
    await agent().post('/api/v1/documents').set('cookie', cookie).send({ title: '50% off deal', content: 'no numbers here' })
    await agent().post('/api/v1/documents').set('cookie', cookie).send({ title: '50 percent alternative', content: 'half price' })

    const literal = await agent().get('/api/v1/documents?search=50%25%20off').set('cookie', cookie)
    expect(literal.status).toBe(200)
    const titles = (literal.body.data.documents as Array<{ title: string }>).map((d) => d.title)
    expect(titles).toContain('50% off deal')
    expect(titles).not.toContain('50 percent alternative')
  })

  it('search is per-user scoped', async () => {
    const first = await registerUser()
    const second = await registerUser()
    await http().post('/api/v1/documents').set('cookie', cookieHeader(first.cookies)).send({ title: 'Shared token unique-xyz', content: '' })
    const asSecond = await http().get('/api/v1/documents?search=unique-xyz').set('cookie', cookieHeader(second.cookies))
    expect(asSecond.status).toBe(200)
    expect(asSecond.body.data.documents).toHaveLength(0)
  })

  it('get/patch/delete honor ownership — other users get 404', async () => {
    const owner = await registerUser()
    const other = await registerUser()
    const cookie = cookieHeader(owner.cookies)
    const created = await http().post('/api/v1/documents').set('cookie', cookie).send({ title: 'Mine', content: 'secret' })
    const id = created.body.data.id as number

    const foreignGet = await http().get(`/api/v1/documents/${id}`).set('cookie', cookieHeader(other.cookies))
    expect(foreignGet.status).toBe(404)
    expect(foreignGet.body.error.code).toBe('NOT_FOUND')

    const patch = await http().patch(`/api/v1/documents/${id}`).set('cookie', cookie).send({ title: 'Renamed' })
    expect(patch.status).toBe(200)
    expect(patch.body.data.title).toBe('Renamed')

    const foreignDelete = await http().delete(`/api/v1/documents/${id}`).set('cookie', cookieHeader(other.cookies))
    expect(foreignDelete.status).toBe(404)

    const del = await http().delete(`/api/v1/documents/${id}`).set('cookie', cookie)
    expect(del.status).toBe(200)
    expect(del.body.ok).toBe(true)

    const gone = await http().get(`/api/v1/documents/${id}`).set('cookie', cookie)
    expect(gone.status).toBe(404)
  })

  it('rejects oversized title/content with 400 VALIDATION_ERROR (bounded payloads, never truncated)', async () => {
    const { agent, user } = await authed('bounds')
    const cookie = cookieHeader(user.cookies)
    const bigTitle = await agent().post('/api/v1/documents').set('cookie', cookie).send({ title: 'x'.repeat(201), content: '' })
    expect(bigTitle.status).toBe(400)
    expect(bigTitle.body.error.code).toBe('VALIDATION_ERROR')
    const bigContent = await agent().post('/api/v1/documents').set('cookie', cookie).send({ title: 'ok', content: 'x'.repeat(10_001) })
    expect(bigContent.status).toBe(400)
    expect(bigContent.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('rejects unauthenticated document access with the envelope 401', async () => {
    const response = await http().get('/api/v1/documents')
    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('UNAUTHORIZED')
  })

  it('unknown document id returns 404 NOT_FOUND', async () => {
    const { agent, user } = await authed('missing')
    const response = await agent().get('/api/v1/documents/999999').set('cookie', cookieHeader(user.cookies))
    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('NOT_FOUND')
  })
})
