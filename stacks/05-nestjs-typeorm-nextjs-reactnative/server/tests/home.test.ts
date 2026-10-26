/**
 * Home endpoint tests: authenticated profile + safe sample metrics.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeTestApp, getTestApp, http, registerUser, cookieHeader } from './helpers.js'

beforeAll(async () => {
  await getTestApp()
})

afterAll(async () => {
  await closeTestApp()
})

describe('home', () => {
  it('returns the authenticated email, metrics and serverTime', async () => {
    const user = await registerUser()
    const response = await http().get('/api/v1/home').set('cookie', cookieHeader(user.cookies))
    expect(response.status).toBe(200)
    expect(response.body.ok).toBe(true)
    expect(response.body.data.email).toBe(user.email)
    expect(Array.isArray(response.body.data.metrics)).toBe(true)
    expect((response.body.data.metrics as unknown[]).length).toBeGreaterThan(0)
    for (const metric of response.body.data.metrics as Array<{ label: string; value: string; unit: string }>) {
      expect(typeof metric.label).toBe('string')
      expect(typeof metric.value).toBe('string')
    }
    expect(() => new Date(response.body.data.serverTime as string).toISOString()).not.toThrow()
  })

  it('reflects document counts in the metrics (safe sample metric)', async () => {
    const user = await registerUser()
    const cookie = cookieHeader(user.cookies)
    await http().post('/api/v1/documents').set('cookie', cookie).send({ title: 'Count me', content: 'x' })
    const response = await http().get('/api/v1/home').set('cookie', cookie)
    const documentsMetric = (response.body.data.metrics as Array<{ label: string; value: string }>).find(
      (m) => m.label === 'Documents stored',
    )
    expect(documentsMetric?.value).toBe('1')
  })

  it('401 without a session (backend auth is the trust boundary)', async () => {
    const response = await http().get('/api/v1/home')
    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('UNAUTHORIZED')
  })

  it('401 with a revoked session cookie', async () => {
    const user = await registerUser()
    const cookie = cookieHeader(user.cookies)
    await http().post('/api/v1/auth/logout').set('cookie', cookie)
    const response = await http().get('/api/v1/home').set('cookie', cookie)
    expect(response.status).toBe(401)
  })
})
