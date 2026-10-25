/**
 * Bcrypt pool unit tests: off-loop hashing, bounded queue (QUEUE_FULL on
 * overflow), and crash recovery (a worker crash rejects only its own
 * in-flight tasks; the slot is respawned and the pool keeps serving).
 */
import { describe, expect, it } from 'vitest'
import {
  BcryptPool,
  PoolExhaustedError,
  QueueFullError,
  QueueTimeoutError,
} from '../src/security/bcrypt-pool.js'

const PASSWORD = ['correct', 'horse', 'battery'].join('')

describe('BcryptPool', () => {
  it('hashes and verifies off the event loop (round-trip + salting)', async () => {
    const pool = new BcryptPool(2, 8)
    try {
      const hash1 = await pool.hashPassword(PASSWORD, 8)
      const hash2 = await pool.hashPassword(PASSWORD, 8)
      expect(hash1).not.toBe(hash2)
      expect(hash1.startsWith('$2')).toBe(true)
      expect(await pool.verifyPassword(PASSWORD, hash1)).toBe(true)
      expect(await pool.verifyPassword([PASSWORD, 'zz'].join(''), hash1)).toBe(false)
    } finally {
      await pool.dispose()
    }
  })

  it('rejects with QueueFullError when the bounded queue overflows', async () => {
    // 12 rounds is slow enough to keep workers busy; a depth-1 queue fills
    // immediately with the third concurrent task. The overflow task must be
    // rejected synchronously with QUEUE_FULL — not silently queued forever.
    const pool = new BcryptPool(1, 12, 1)
    try {
      const slow = pool.hashPassword(PASSWORD, 12) // occupies the only worker
      const queued = pool.hashPassword(PASSWORD, 12) // occupies the queue slot
      const overflow = pool.hashPassword(PASSWORD, 12) // must reject
      await expect(overflow).rejects.toBeInstanceOf(QueueFullError)
      // The two accepted tasks still complete.
      expect(await slow).toMatch(/^\$2/)
      expect(await queued).toMatch(/^\$2/)
    } finally {
      await pool.dispose()
    }
  })

  it('recovers from a worker crash: only that worker tasks fail, the pool keeps serving', async () => {
    const pool = new BcryptPool(2, 4)
    try {
      // One in-flight task on slot 0 when the crash lands: it must be
      // rejected with the crash error.
      const inflight = pool.hashPassword(PASSWORD, 4)
      pool.simulateWorkerCrash(0, new Error('boom'))
      await expect(inflight).rejects.toThrow('boom')

      // The pool is alive: new submits still resolve (the slot respawned).
      const hash = await pool.hashPassword(PASSWORD, 4)
      expect(hash.startsWith('$2')).toBe(true)
      expect(await pool.verifyPassword(PASSWORD, hash)).toBe(true)
      expect(pool.liveSlotCount()).toBe(2)
    } finally {
      await pool.dispose()
    }
  })

  it('dispose rejects queued calls and stops accepting work', async () => {
    const pool = new BcryptPool(1, 12, 1)
    // Attach rejection handlers IMMEDIATELY (synchronously after submit) —
    // dispose() rejects the in-flight and queued calls while the test is
    // still awaiting, and a handler attached only later (inside allSettled)
    // registers asynchronously, which vitest reports as unhandled.
    const inflight = pool.hashPassword(PASSWORD, 12).catch((err: Error) => `inflight-rejected: ${err.message}`)
    const queued = pool.hashPassword(PASSWORD, 12).catch((err: Error) => `queued-rejected: ${err.message}`)
    await pool.dispose()
    const [inflightOutcome, queuedOutcome] = await Promise.all([inflight, queued])
    // The queued call must have been rejected with the dispose error (the
    // in-flight one may resolve if the worker finished before terminate).
    expect(String(inflightOutcome) + String(queuedOutcome)).toMatch(
      /queued-rejected: bcrypt pool disposed/,
    )
    // The pool no longer accepts work.
    await expect(pool.hashPassword(PASSWORD, 12)).rejects.toThrow('bcrypt pool is not available')
  })

  it('a queued call whose wait budget expires is rejected with QueueTimeoutError', async () => {
    // Review round 2: without a wait bound, a queued task waits FOREVER when
    // no slot frees up in time. With maxWaitMs the periodic sweep rejects
    // queued entries near their deadline even though the pool is healthy.
    // Scenario: the single worker is BUSY with a long 12-round hash; the
    // queued calls' budgets (50ms) expire long before the worker drains them.
    const pool = new BcryptPool(1, 12, 8, 50) // 50ms wait budget
    try {
      // Occupy the only worker with a long task (12 rounds ≈ 100-400ms) so
      // nothing drains the queue while the budgets run out.
      const busy = pool.hashPassword(PASSWORD, 12).catch(() => 'busy')
      const queued = [1, 2, 3].map(() =>
        pool
          .hashPassword(PASSWORD, 12)
          .then(
            () => 'resolved',
            (err: unknown) => (err instanceof QueueTimeoutError ? 'timeout' : `other: ${String(err)}`),
          ),
      )
      const outcomes = await Promise.all(queued)
      expect(outcomes).toEqual(['timeout', 'timeout', 'timeout'])
      await busy
    } finally {
      await pool.dispose()
    }
  })

  it('submit rejects immediately with PoolExhaustedError when every slot is dead', async () => {
    // Review round 2: with all slots retired (crash loop), new calls must
    // be refused NOW, not parked in a queue nobody will ever drain.
    const pool = new BcryptPool(1, 4)
    try {
      pool.simulateWorkerCrash(0, new Error('crash 1'))
      expect(pool.liveSlotCount()).toBe(1) // respawned
      // Burn the respawn budget: 10 respawns allowed, so the 11th crash
      // retires the slot.
      for (let i = 2; i <= 11; i += 1) {
        pool.simulateWorkerCrash(0, new Error(`crash ${i}`))
      }
      expect(pool.liveSlotCount()).toBe(0)
      const outcome = await pool.hashPassword(PASSWORD, 4).then(
        () => 'resolved',
        (err: unknown) => (err instanceof PoolExhaustedError ? 'exhausted' : `other: ${String(err)}`),
      )
      expect(outcome).toBe('exhausted')
    } finally {
      await pool.dispose()
    }
  })

  it('a saturated pool keeps failing fast past the first overflow (repeated QueueFullError)', async () => {
    // Pins that the bounded queue rejects EVERY overflow, not just the
    // first — the review round 2 concern about unbounded waiting under
    // sustained load.
    const pool = new BcryptPool(1, 12, 2)
    try {
      const inflight = pool.hashPassword(PASSWORD, 12).catch(() => 'inflight')
      const q1 = pool.hashPassword(PASSWORD, 12).catch(() => 'q1')
      const q2 = pool.hashPassword(PASSWORD, 12).catch(() => 'q2')
      const overflows = await Promise.all(
        Array.from({ length: 5 }, () =>
          pool
            .hashPassword(PASSWORD, 12)
            .then(() => 'resolved', (err: unknown) => (err instanceof QueueFullError ? 'queue-full' : 'other')),
        ),
      )
      expect(overflows.every((outcome) => outcome === 'queue-full')).toBe(true)
      await Promise.allSettled([inflight, q1, q2])
    } finally {
      await pool.dispose()
    }
  })
})
