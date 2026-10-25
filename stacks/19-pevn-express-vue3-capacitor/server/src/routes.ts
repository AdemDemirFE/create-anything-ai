/**
 * /api/v1 routes. Every response is envelope-wrapped ({ok,data,error,
 * requestId}); errors carry stable codes and safe messages.
 *
 * Register discipline (Stack-15 mixed-case lesson): the email is normalized
 * (trim + lowercase) BEFORE the uniqueness pre-check, so the checked value
 * equals the stored value. The MongoDB unique index stays the real guard
 * against concurrent registrations (E11000 maps to the same stable 409 —
 * task contract: 422/409, no 500, no exception leakage).
 */
import express, { type Request, type RequestHandler } from 'express'
import { performance } from 'node:perf_hooks'
import * as codes from './error-codes.js'
import { envelopeError, envelopeOk, validationError } from './envelope.js'
import { User, StackDocument, toPublicDocument, toPublicUser, type DocumentDoc, type UserDoc } from './models.js'
import { BcryptPool } from './security/bcrypt-pool.js'
import {
  attachSessionCookie,
  createSession,
  currentUser,
  destroySession,
  type SessionConfig,
} from './security/sessions.js'
import { clearFailures, clientIp, isThrottled, recordFailure, type ThrottleConfig } from './security/throttle.js'
import { normalizeEmail } from './validation.js'
import { CATALOG, InputTooLargeError, InvalidInputError, MAX_INPUT_LENGTH, UnknownAlgorithmError, runAlgorithm } from './algorithm/catalog.js'

const ALGO_MAX_INPUT_LENGTH = MAX_INPUT_LENGTH
import {
  parseCredentials,
  parseDocumentInput,
  parsePagination,
} from './validation.js'
import type { Config } from './config.js'

export interface Deps {
  config: Config
  bcryptPool: BcryptPool
}

function requireUser(config: SessionConfig): RequestHandler {
  const handler: RequestHandler = async (req, res, next) => {
    try {
      const user = await currentUser(req, config)
      if (!user) {
        envelopeError(res, 401, codes.UNAUTHORIZED, 'Authentication required.')
        return
      }
      ;(req as Request & { user?: UserDoc }).user = user
      next()
    } catch (err) {
      next(err)
    }
  }
  return handler
}

function authUser(req: Request): UserDoc {
  const user = (req as Request & { user?: UserDoc }).user
  if (!user) throw new Error('authUser() used on an unauthenticated route')
  return user
}

/**
 * MongoDB duplicate-key rejection (E11000): the unique email index is the
 * real guard against concurrent registrations that both pass the pre-check.
 * Exported for tests.
 */
export function isDuplicateKeyError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const e = err as { code?: unknown; codeName?: unknown }
  return e.code === 11000 || e.code === 11001 || e.codeName === 'DuplicateKey'
}

/** A fixed non-secret throwaway hash, computed once, for timing equalization. */
let timingEqualizerHash: string | null = null
async function getTimingEqualizerHash(pool: BcryptPool): Promise<string> {
  if (timingEqualizerHash === null) {
    timingEqualizerHash = await pool.hashPassword('timing-equalizer-throwaway', 10)
  }
  return timingEqualizerHash
}

export function buildRouter(deps: Deps): express.Router {
  const router = express.Router()
  const { config, bcryptPool } = deps
  const sessionConfig: SessionConfig = { ttlMinutes: config.sessionTtlMinutes, secureCookies: config.secureCookies }
  const throttleConfig: ThrottleConfig = {
    windowSeconds: config.throttleWindowSeconds,
    maxFailures: config.throttleMaxFailures,
  }

  // --- health (public; trivial probe, intentionally envelope-less) ----------
  router.get('/health', (_req, res) => {
    res.json({ status: 'ok' })
  })

  // --- register (public) -----------------------------------------------------
  router.post('/register', (req, res, next) => {
    void (async () => {
      try {
        const { value, issues } = parseCredentials(req.body)
        if (!value) {
          validationError(res, issues)
          return
        }
        // Normalize BEFORE the unique pre-check (Stack-15 lesson): the value
        // checked here must be byte-identical to the value stored below and
        // looked up at login. Mixed-case input can never slip past this
        // check and resurface as an E11000 500.
        const email = normalizeEmail(value.email)
        const existing = await User.findOne({ email })
        if (existing) {
          // Stable, non-leaking duplicate response.
          envelopeError(res, 409, codes.EMAIL_TAKEN, 'An account with this email already exists.')
          return
        }
        const passwordHash = await bcryptPool.hashPassword(value.password, config.bcryptRounds)
        let user: UserDoc
        try {
          user = (await User.create({ email, passwordHash })) as unknown as UserDoc
        } catch (err) {
          // Race-proof duplicate handling: the pre-check above only narrows
          // the common path; two concurrent registers for the same email can
          // both pass it, and the unique index is the real guard. Map the
          // duplicate-key rejection (E11000) to the same stable 409 the
          // pre-check returns — never a 500, no exception text leakage
          // (task contract: E11000 → 422/409; we use 409 EMAIL_TAKEN, the
          // same code the pre-check path returns).
          if (isDuplicateKeyError(err)) {
            envelopeError(res, 409, codes.EMAIL_TAKEN, 'An account with this email already exists.')
            return
          }
          throw err
        }
        envelopeOk(res, { user: toPublicUser(user) }, 201)
      } catch (err) {
        next(err)
      }
    })()
  })

  // --- login (public, throttled) ----------------------------------------------
  router.post('/login', (req, res, next) => {
    void (async () => {
      try {
        const { value, issues } = parseCredentials(req.body)
        if (!value) {
          validationError(res, issues)
          return
        }
        const email = normalizeEmail(value.email)
        const ip = clientIp(req)

        if (isThrottled(email, ip, throttleConfig)) {
          // Retry-After is its own config knob (Stack-18/20 lesson) — it may
          // differ from the window length.
          res.setHeader('Retry-After', String(config.throttleRetryAfterSeconds))
          envelopeError(res, 429, codes.RATE_LIMITED, 'Too many failed login attempts. Try again later.')
          return
        }

        const user = (await User.findOne({ email })) as unknown as UserDoc | null
        if (!user) {
          // Unknown email: burn one bcrypt verification against a fixed
          // non-secret throwaway hash so response timing does not reveal
          // whether the account exists. Failures count toward the throttle.
          await bcryptPool.verifyPassword(value.password, await getTimingEqualizerHash(bcryptPool))
          recordFailure(email, ip, throttleConfig)
          envelopeError(res, 401, codes.INVALID_CREDENTIALS, 'Invalid email or password.')
          return
        }

        const ok = await bcryptPool.verifyPassword(value.password, user.passwordHash)
        if (!ok) {
          recordFailure(email, ip, throttleConfig)
          envelopeError(res, 401, codes.INVALID_CREDENTIALS, 'Invalid email or password.')
          return
        }

        clearFailures(email, ip)
        // Fresh token on every login (session-fixation defense); the cookie
        // rides on this exact response.
        const token = await createSession(user, sessionConfig)
        attachSessionCookie(res, token, sessionConfig)
        envelopeOk(res, { user: toPublicUser(user) })
      } catch (err) {
        next(err)
      }
    })()
  })

  // --- logout (public by contract: clears whatever session is presented) ------
  router.post('/logout', (req, res, next) => {
    void (async () => {
      try {
        await destroySession(req, res, sessionConfig)
        envelopeOk(res, null)
      } catch (err) {
        next(err)
      }
    })()
  })

  // --- home (protected) ---------------------------------------------------------
  router.get('/home', requireUser(sessionConfig), (req, res, next) => {
    void (async () => {
      try {
        const user = authUser(req)
        envelopeOk(res, {
          email: user.email,
          metrics: [
            { label: 'Stored documents', value: String(await StackDocument.countDocuments({ userId: user._id })), unit: 'count' },
            { label: 'Uptime today', value: '99.9', unit: 'percent' },
          ],
          serverTime: new Date().toISOString(),
        })
      } catch (err) {
        next(err)
      }
    })()
  })

  // --- algorithm workbench (protected; fixed catalog, bounded input) -------------
  router.get('/algorithm', requireUser(sessionConfig), (_req, res) => {
    envelopeOk(
      res,
      Object.values(CATALOG).map((spec) => ({
        id: spec.id,
        name: spec.name,
        complexity: spec.complexity,
        explanation: spec.explanation,
      })),
    )
  })

  router.post('/algorithm/run', requireUser(sessionConfig), (req, res, next) => {
    void (async () => {
      try {
        const body = (req.body ?? {}) as Record<string, unknown>
        const algorithm = typeof body.algorithm === 'string' ? body.algorithm : ''
        const input = typeof body.input === 'string' ? body.input : ''

        if (algorithm === '' || input === '') {
          envelopeError(res, 400, codes.VALIDATION_ERROR, 'The request contains invalid fields.', [
            ...(algorithm === '' ? [{ field: 'algorithm', code: 'REQUIRED' }] : []),
            ...(input === '' ? [{ field: 'input', code: 'REQUIRED' }] : []),
          ])
          return
        }
        if (input.length > ALGO_MAX_INPUT_LENGTH) {
          envelopeError(res, 400, codes.INPUT_TOO_LARGE, `Input exceeds the maximum length of ${ALGO_MAX_INPUT_LENGTH} characters.`)
          return
        }

        const startNs = performance.now()
        let result: { output: string; spec: { id: string; complexity: string; explanation: string } }
        try {
          result = runAlgorithm(algorithm, input)
        } catch (err) {
          if (err instanceof InputTooLargeError) {
            envelopeError(res, 400, codes.INPUT_TOO_LARGE, `Input exceeds the maximum length of ${MAX_INPUT_LENGTH} characters.`)
            return
          }
          if (err instanceof UnknownAlgorithmError) {
            envelopeError(res, 400, codes.UNKNOWN_ALGORITHM, 'Unknown algorithm. Choose one from the catalog.')
            return
          }
          if (err instanceof InvalidInputError) {
            envelopeError(res, 400, codes.INVALID_INPUT, 'The input is invalid for this algorithm.')
            return
          }
          throw err
        }
        // Measured wall-clock duration (monotonic clock) — reported
        // separately from the theoretical Big-O; never fabricated.
        const executionMs = Number((performance.now() - startNs).toFixed(3))
        envelopeOk(res, {
          algorithmId: result.spec.id,
          output: result.output,
          executionMs,
          complexity: result.spec.complexity,
          explanation: result.spec.explanation,
        })
      } catch (err) {
        next(err)
      }
    })()
  })

  // --- documents CRUD (protected; ownership-scoped) -------------------------------
  router.post('/documents', requireUser(sessionConfig), (req, res, next) => {
    void (async () => {
      try {
        const { value, issues } = parseDocumentInput(req.body)
        if (!value || value.title === undefined || value.content === undefined) {
          validationError(res, issues)
          return
        }
        const user = authUser(req)
        const doc = (await StackDocument.create({
          userId: user._id,
          title: value.title,
          content: value.content,
          ...(value.tags !== undefined ? { tags: value.tags } : {}),
        })) as unknown as DocumentDoc
        envelopeOk(res, { document: toPublicDocument(doc) }, 201)
      } catch (err) {
        next(err)
      }
    })()
  })

  router.get('/documents', requireUser(sessionConfig), (req, res, next) => {
    void (async () => {
      try {
        const { page, limit, issues } = parsePagination(req.query as Record<string, unknown>)
        if (issues.length > 0) {
          validationError(res, issues)
          return
        }
        const user = authUser(req)
        const filter = { userId: user._id }
        const [items, total] = await Promise.all([
          StackDocument.find(filter)
            .sort({ updatedAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit),
          StackDocument.countDocuments(filter),
        ])
        envelopeOk(res, {
          documents: items.map((item) => toPublicDocument(item as unknown as DocumentDoc)),
          pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
        })
      } catch (err) {
        next(err)
      }
    })()
  })

  const loadOwnedDocument = async (
    req: Request,
  ): Promise<{ doc: DocumentDoc } | { notFound: true } | { invalidId: true }> => {
    const { id } = req.params
    if (typeof id !== 'string' || !/^[a-f\d]{24}$/i.test(id)) {
      return { invalidId: true }
    }
    const user = authUser(req)
    const doc = (await StackDocument.findOne({ _id: id, userId: user._id })) as unknown as DocumentDoc | null
    return doc ? { doc } : { notFound: true }
  }

  router.get('/documents/:id', requireUser(sessionConfig), (req, res, next) => {
    void (async () => {
      try {
        const loaded = await loadOwnedDocument(req)
        if ('invalidId' in loaded) {
          envelopeError(res, 400, codes.INVALID_ID, 'The document id is not a valid identifier.')
          return
        }
        if ('notFound' in loaded) {
          // Same response for "someone else's document" and "no such
          // document": existence is not disclosed across accounts.
          envelopeError(res, 404, codes.NOT_FOUND, 'Document not found.')
          return
        }
        envelopeOk(res, { document: toPublicDocument(loaded.doc) })
      } catch (err) {
        next(err)
      }
    })()
  })

  router.put('/documents/:id', requireUser(sessionConfig), (req, res, next) => {
    void (async () => {
      try {
        const { value, issues } = parseDocumentInput(req.body, { partial: true })
        if (issues.length > 0 || (value && value.title === undefined && value.content === undefined && value.tags === undefined)) {
          if (issues.length > 0) {
            validationError(res, issues)
          } else {
            envelopeError(res, 400, codes.VALIDATION_ERROR, 'Provide at least one updatable field.')
          }
          return
        }
        const loaded = await loadOwnedDocument(req)
        if ('invalidId' in loaded) {
          envelopeError(res, 400, codes.INVALID_ID, 'The document id is not a valid identifier.')
          return
        }
        if ('notFound' in loaded) {
          envelopeError(res, 404, codes.NOT_FOUND, 'Document not found.')
          return
        }
        const doc = loaded.doc
        if (value?.title !== undefined) doc.title = value.title
        if (value?.content !== undefined) doc.content = value.content
        if (value?.tags !== undefined) doc.tags = value.tags
        await doc.save()
        envelopeOk(res, { document: toPublicDocument(doc) })
      } catch (err) {
        next(err)
      }
    })()
  })

  router.delete('/documents/:id', requireUser(sessionConfig), (req, res, next) => {
    void (async () => {
      try {
        const { id } = req.params
        if (typeof id !== 'string' || !/^[a-f\d]{24}$/i.test(id)) {
          envelopeError(res, 400, codes.INVALID_ID, 'The document id is not a valid identifier.')
          return
        }
        const user = authUser(req)
        const deleted = await StackDocument.findOneAndDelete({ _id: id, userId: user._id })
        if (!deleted) {
          envelopeError(res, 404, codes.NOT_FOUND, 'Document not found.')
          return
        }
        envelopeOk(res, { deletedId: id })
      } catch (err) {
        next(err)
      }
    })()
  })

  return router
}
