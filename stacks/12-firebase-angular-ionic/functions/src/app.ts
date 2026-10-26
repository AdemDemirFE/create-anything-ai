/**
 * Express app factory — Stack 12.
 *
 * The app is transport-agnostic: in production it is wrapped by Cloud
 * Functions v2 onRequest; in tests it is driven directly by supertest with
 * firebase-admin pointed at the emulators. The wire contract is identical.
 * No SSE endpoints exist (rule 6) — responses are plain JSON envelopes only.
 *
 * Separate prefixes (rule 7): every API route mounts under /api/v1; the web
 * client is served elsewhere (Angular dev server / static hosting) and never
 * shares this prefix.
 */
import cookieParser from 'cookie-parser'
import express, {
  type Express,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express'
import { API_PREFIX, config } from './config.js'
import {
  ApiError,
  envelopeErrorHandler,
  envelopeNotFound,
  envelopeOk,
  requestIdMiddleware,
} from './envelope.js'
import { ErrorCodes } from './error-codes.js'
import {
  LOGIN_GENERIC,
  assertValidEmail,
  registerUser,
  verifyCredentials,
} from './identity.js'
import { destroySession, establishSession, resolveSession } from './session.js'
import type { SessionUser } from './types.js'
import { loginThrottle, reportLoginFailure } from './throttle.js'
import { getAlgorithm, listAlgorithms } from './algorithms.js'
import { createDocument, deleteDocument, getDocument, listDocuments, updateDocument } from './documents.js'

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next)
  }
}

/** Middleware: require a valid session or 401 (backend re-check per PRD §6). */
function requireUser(): RequestHandler {
  return (req, res, next) => {
    resolveSession(req)
      .then((user) => {
        res.locals.user = user
        next()
      })
      .catch(next)
  }
}

export function createApp(): Express {
  const app = express()
  app.disable('x-powered-by')
  app.use(express.json({ limit: '256kb' }))
  app.use(cookieParser())

  // Request-id echo applies to EVERY /api/v1 response, including health.
  app.use(API_PREFIX, requestIdMiddleware)

  // --- health: intentionally envelope-less trivial probe ---------------------
  app.get(`${API_PREFIX}/health`, (_req, res) => {
    res.json({ status: 'ok' })
  })

  const api = express.Router()

  // --- register (public) ------------------------------------------------------
  api.post(
    '/auth/register',
    asyncHandler(async (req, res) => {
      const b = (req.body ?? {}) as { email?: unknown; password?: unknown; displayName?: unknown }
      const user = await registerUser(b.email, b.password, b.displayName)
      envelopeOk(res, { user }, req.requestId ?? '')
    }),
  )

  // --- login (public, throttled) ----------------------------------------------
  api.post(
    '/auth/login',
    loginThrottle(),
    asyncHandler(async (req, res) => {
      const b = (req.body ?? {}) as { email?: unknown; password?: unknown }
      const email = assertValidEmail(b.email)
      const password = assertLoginPassword(b.password)
      try {
        const creds = await verifyCredentials(email, password)
        const user = await establishSession(res, creds.idToken)
        envelopeOk(res, { user }, req.requestId ?? '')
      } catch (err) {
        // Count only credential failures, not validation or transport errors.
        if (err instanceof ApiError && err.status === 401) reportLoginFailure(res)
        throw err
      }
    }),
  )

  // --- logout (public by contract: clears whatever is presented) ---------------
  api.post(
    '/auth/logout',
    asyncHandler(async (req, res) => {
      await destroySession(req, res)
      envelopeOk(res, null, req.requestId ?? '')
    }),
  )

  // --- home (protected) ---------------------------------------------------------
  api.get(
    '/home',
    requireUser(),
    asyncHandler(async (req, res) => {
      const user = res.locals.user as SessionUser
      const total = await countDocumentsFor(user.uid)
      envelopeOk(
        res,
        {
          user: { email: user.email, displayName: user.displayName },
          metrics: [
            { label: 'Stored documents', value: String(total), unit: 'count' },
            { label: 'Algorithms available', value: String(listAlgorithms().length), unit: 'count' },
          ],
          serverTime: new Date().toISOString(),
        },
        req.requestId ?? '',
      )
    }),
  )

  // --- algorithm workbench (protected; fixed catalog, bounded input) -------------
  api.get(
    '/algorithms',
    requireUser(),
    (req, res) => {
      envelopeOk(
        res,
        listAlgorithms().map((a) => ({ id: a.id, name: a.name, complexity: a.complexity, explanation: a.explanation })),
        req.requestId ?? '',
      )
    },
  )

  api.post(
    '/algorithms/:id/run',
    requireUser(),
    asyncHandler(async (req, res) => {
      const spec = getAlgorithm(req.params.id)
      if (!spec) throw new ApiError(404, ErrorCodes.NotFound, 'Unknown algorithm.')
      const input = (req.body as { input?: unknown } | undefined)?.input
      if (typeof input !== 'string') throw new ApiError(422, ErrorCodes.Validation, 'input must be a string.')
      if (input.length > config.bounds.maxAlgorithmInputLength) {
        throw new ApiError(413, ErrorCodes.InputTooLarge, `input exceeds ${config.bounds.maxAlgorithmInputLength} characters.`)
      }
      const started = process.hrtime.bigint()
      let output: string
      try {
        output = spec.run(input)
      } catch (err) {
        throw new ApiError(422, ErrorCodes.Validation, err instanceof Error ? err.message : 'Invalid input.')
      }
      const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000
      envelopeOk(
        res,
        {
          algorithmId: spec.id,
          output,
          durationMs: Math.round(durationMs * 100) / 100,
          complexity: spec.complexity,
          explanation: spec.explanation,
        },
        req.requestId ?? '',
      )
    }),
  )

  // --- documents CRUD (protected, owner-scoped) -----------------------------------
  api.get(
    '/documents',
    requireUser(),
    asyncHandler(async (req, res) => {
      const user = res.locals.user as SessionUser
      envelopeOk(res, await listDocuments(user, req.query.page, req.query.limit), req.requestId ?? '')
    }),
  )

  api.post(
    '/documents',
    requireUser(),
    asyncHandler(async (req, res) => {
      const user = res.locals.user as SessionUser
      envelopeOk(res, await createDocument(user, req.body), req.requestId ?? '')
    }),
  )

  api.get(
    '/documents/:id',
    requireUser(),
    asyncHandler(async (req, res) => {
      const user = res.locals.user as SessionUser
      envelopeOk(res, await getDocument(user, req.params.id), req.requestId ?? '')
    }),
  )

  api.put(
    '/documents/:id',
    requireUser(),
    asyncHandler(async (req, res) => {
      const user = res.locals.user as SessionUser
      envelopeOk(res, await updateDocument(user, req.params.id, req.body), req.requestId ?? '')
    }),
  )

  api.delete(
    '/documents/:id',
    requireUser(),
    asyncHandler(async (req, res) => {
      const user = res.locals.user as SessionUser
      await deleteDocument(user, req.params.id)
      envelopeOk(res, null, req.requestId ?? '')
    }),
  )

  app.use(API_PREFIX, api)

  // --- envelope-wrapped 404 for anything else under the API prefix -------------
  app.use(API_PREFIX, (req, res) => {
    envelopeNotFound(req, res)
  })

  // --- error envelope (last) ---------------------------------------------------
  app.use(envelopeErrorHandler)

  return app
}

function assertLoginPassword(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > config.bounds.maxPasswordLength) {
    throw new ApiError(401, ErrorCodes.InvalidCredentials, LOGIN_GENERIC)
  }
  return raw
}

async function countDocumentsFor(uid: string): Promise<number> {
  const { getFirestore } = await import('firebase-admin/firestore')
  const col = getFirestore().collection('users').doc(uid).collection('documents')
  const snap = await col.count().get()
  return snap.data().count
}
