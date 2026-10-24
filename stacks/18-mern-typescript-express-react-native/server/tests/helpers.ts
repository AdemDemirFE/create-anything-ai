/**
 * Test harness: one REAL mongod (mongodb-memory-server) for the whole suite,
 * one database per test file for isolation.
 */
import path from 'node:path'
import { MongoMemoryServer } from 'mongodb-memory-server-core'
import mongoose from 'mongoose'
import request from 'supertest'
import type { Express } from 'express'
import { createApp } from '../src/app.js'
import { connectMongo, disconnectMongo } from '../src/db.js'
import { resetThrottle } from '../src/security/throttle.js'
import type { Config } from '../src/config.js'

let mongod: MongoMemoryServer | null = null

export async function startMongo(): Promise<string> {
  if (!mongod) {
    mongod = await MongoMemoryServer.create({
      instance: { storageEngine: 'wiredTiger' },
      binary: {
        version: '7.0.14',
        downloadDir: path.join(process.cwd(), '.mongodb-binaries'),
      },
    })
  }
  return mongod.getUri()
}

export async function stopMongo(): Promise<void> {
  if (mongod) {
    await mongod.stop()
    mongod = null
  }
}

export interface TestApp {
  app: Express
  config: Config
  bcryptPool: Awaited<ReturnType<typeof createApp>>['bcryptPool']
  dbName: string
}

/**
 * Creates an app wired to a fresh database inside the shared mongod.
 * `configOverrides` covers the per-suite knobs (throttle, TTL, rounds).
 */
export async function createTestApp(configOverrides: Partial<Config> = {}): Promise<TestApp> {
  const uri = await startMongo()
  const dbName = `stack18_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  await connectMongo(uri, dbName)
  const created = createApp({
    bcryptWorkers: 2,
    ...configOverrides,
  })
  return { app: created.app, config: created.config, bcryptPool: created.bcryptPool, dbName }
}

export async function destroyTestApp(testApp: TestApp): Promise<void> {
  await testApp.bcryptPool.dispose()
  await mongoose.connection.dropDatabase()
  await disconnectMongo()
}

export { request, resetThrottle }
