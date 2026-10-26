/**
 * Test harness: a REAL sqlite database (better-sqlite3, in-memory) per test
 * file for isolation, the full AppModule HTTP stack via supertest.
 */
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { createApp } from '../src/create-app.js'

let app: INestApplication | null = null

export async function getTestApp(): Promise<INestApplication> {
  if (!app) {
    app = await createApp()
  }
  return app
}

export async function closeTestApp(): Promise<void> {
  if (app) {
    await app.close()
    app = null
  }
}

export function http(): request.Agent {
  return request(app?.getHttpServer() as Parameters<typeof request>[0])
}

function getApp(): INestApplication | null {
  return app
}

export interface RegisterOptions {
  email?: string
  password?: string
}

const RUNNING_INDEX = { value: 0 }

/** Unique-per-call test email (must pass the register validation rules). */
export function uniqueEmail(prefix = 'user'): string {
  RUNNING_INDEX.value += 1
  return `${prefix}-${Date.now()}-${RUNNING_INDEX.value}@example.com`
}

export const STRONG_PASSWORD = 'Correct-Horse-9x'

/** Registers a fresh user and returns the session cookie jar. */
export async function registerUser(options: RegisterOptions = {}): Promise<{
  email: string
  password: string
  cookies: string[]
  userId: number
}> {
  const email = options.email ?? uniqueEmail()
  const password = options.password ?? STRONG_PASSWORD
  const agent = http()
  const response = await agent.post('/api/v1/auth/register').send({ email, password })
  if (response.status !== 201) {
    throw new Error(`register failed: ${response.status} ${JSON.stringify(response.body)}`)
  }
  const cookies = response.headers['set-cookie'] as unknown as string[]
  return { email, password, cookies, userId: response.body.data.user.id as number }
}

/** Cookie header string from a register/login response. */
export function cookieHeader(cookies: string[]): string {
  return cookies.map((cookie) => cookie.split(';')[0]).join('; ')
}
