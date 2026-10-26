/**
 * Cloud Functions entrypoint (production shape).
 *
 * The same Express app runs under Cloud Functions v2 onRequest in production
 * and under supertest against the emulators in tests — the wire contract is
 * identical. Memory/region are pinned for deterministic latency.
 */
import { onRequest } from 'firebase-functions/v2/https'
import { createApp } from './app.js'

const api = createApp()

export const stack12Api = onRequest(
  {
    region: 'europe-west1',
    memory: '256MiB',
    maxInstances: 10,
    invoker: 'public',
  },
  api,
)
