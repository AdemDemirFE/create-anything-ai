/**
 * Express application factory (no listening here — tests import this).
 *
 * Middleware order:
 * 1. requestIdMiddleware — validates X-Request-Id, pins it for the envelope.
 * 2. cors (allowlist) — browser clients on non-same-origin deployments.
 * 3. express.json (bounded) — oversized bodies fail fast with 400.
 * 4. cookie-parser — HttpOnly session cookie parsing.
 * 5. /api/v1 router.
 * 6. error boundary — every uncaught error becomes a generic 500 envelope.
 */
import express, { type Express } from 'express'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import { loadConfig, type Config } from './config.js'
import { requestIdMiddleware, errorBoundary } from './envelope.js'
import { errorCodes } from './error-codes.js'
import { BcryptPool } from './security/bcrypt-pool.js'
import { buildRouter } from './routes.js'

export interface CreateAppResult {
  app: Express
  config: Config
  bcryptPool: BcryptPool
}

export function createApp(overrides: Partial<Config> = {}): CreateAppResult {
  const config = { ...loadConfig(), ...overrides }
  const bcryptPool = new BcryptPool(config.bcryptWorkers, config.bcryptRounds)
  const app = express()

  app.disable('x-powered-by')
  app.use(requestIdMiddleware)
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || config.allowedOrigins.includes(origin)) {
          callback(null, true)
        } else {
          callback(null, false)
        }
      },
      credentials: true,
    }),
  )
  // Bounded JSON bodies: 64 kB is far above every documented payload bound.
  app.use(express.json({ limit: '64kb' }))
  app.use(cookieParser())

  app.use('/api/v1', buildRouter({ config, bcryptPool }))

  // Unknown /api routes still get the envelope treatment.
  app.use('/api', (_req, res) => {
    res.status(404).json({
      ok: false,
      data: null,
      error: { code: 'NOT_FOUND', message: 'Route not found.' },
      requestId: res.locals.requestId as string,
    })
  })

  // Malformed JSON bodies (express.json parse errors) → 400 envelope.
  const jsonBodyErrorHandler: express.ErrorRequestHandler = (err, _req, res, next) => {
    if (err instanceof SyntaxError && 'body' in err) {
      res.status(400).json({
        ok: false,
        data: null,
        error: { code: errorCodes.VALIDATION_ERROR, message: 'The request body is not valid JSON.' },
        requestId: res.locals.requestId as string,
      })
      return
    }
    next(err)
  }
  app.use(jsonBodyErrorHandler)

  app.use(errorBoundary)
  return { app, config, bcryptPool }
}
