/**
 * Off-the-loop bcrypt via a bounded `worker_threads` pool (Stack-18 lesson).
 *
 * Why: bcrypt (12 rounds) costs 100-300 ms of pure CPU per call; running it
 * on the main thread would freeze every concurrent request. This module
 * dispatches hash/compare work to a fixed pool of worker threads (Node
 * stdlib only, no extra dependency) and awaits the result.
 *
 * The worker source is an eval'd string that imports bcryptjs via
 * createRequire against an absolute path captured on the main thread
 * (Stack-18 lesson: `require` is unavailable inside eval'd ESM-context
 * workers on modern Node) — no worker file on disk, so it works identically
 * under vitest, tsx and compiled dist output.
 *
 * Review follow-up hardening:
 * - The internal queue is bounded (`maxQueueDepth`): when full, submit()
 *   rejects immediately with a QUEUE_FULL error instead of growing without
 *   bound under load (fail fast; the login route maps it to a plain 500).
 * - Queued calls carry a wait budget (`maxWaitMs`, default 10 s): a call
 *   that cannot be served within it is rejected with QueueTimeoutError by
 *   a periodic sweep — a queued task can never wait forever, even if every
 *   worker dies right after it was enqueued.
 * - If ALL slots are dead/retired, submit() rejects immediately with
 *   PoolExhaustedError instead of queueing into a queue nobody drains.
 * - A crashed worker no longer kills the whole pool permanently: only the
 *   tasks dispatched to THAT worker are rejected, the slot is respawned
 *   (up to MAX_RESPAWNS_PER_SLOT against crash loops), and subsequent
 *   submits keep working.
 * - Per-worker pending tracking is what makes that containment possible.
 */
import { createRequire } from 'node:module'
import os from 'node:os'
import { Worker } from 'node:worker_threads'

const nodeRequire = createRequire(import.meta.url)
const bcryptModulePath = nodeRequire.resolve('bcryptjs')

const WORKER_SOURCE = `
const { parentPort, workerData } = await import('node:worker_threads');
const { createRequire } = await import('node:module');
// bcryptjs ships a real CJS entry; resolve it against the absolute module
// path captured on the main thread (worker cwd is not trustworthy).
const bcrypt = createRequire(workerData.bcryptPath)(workerData.bcryptPath);
parentPort.on('message', async (task) => {
  try {
    let result;
    if (task.op === 'hash') {
      result = await bcrypt.hash(task.password, task.rounds);
    } else if (task.op === 'compare') {
      result = await bcrypt.compare(task.password, task.hash);
    } else {
      throw new Error('unknown op: ' + String(task.op));
    }
    parentPort.postMessage({ id: task.id, ok: true, result });
  } catch (err) {
    parentPort.postMessage({ id: task.id, ok: false, error: String(err && err.message ? err.message : err) });
  }
});
`

interface HashTask {
  op: 'hash'
  password: string
  rounds: number
}

interface CompareTask {
  op: 'compare'
  password: string
  hash: string
}

type BcryptTask = HashTask | CompareTask

interface PendingCall {
  resolve: (value: string | boolean) => void
  reject: (reason: Error) => void
}

interface WorkerHandle {
  worker: Worker
  busy: boolean
  /** Task ids currently dispatched to THIS worker (crash containment scope). */
  inflight: Set<number>
  /** Respawn count for crash-loop bounding. */
  respawns: number
  /** Set when the slot exceeded its respawn budget; it no longer accepts work. */
  dead: boolean
}

/** Thrown when the bounded queue is full (fail fast, no unbounded growth). */
export class QueueFullError extends Error {
  readonly code = 'QUEUE_FULL'
  constructor() {
    super('bcrypt pool queue is full')
    this.name = 'QueueFullError'
  }
}

/** Thrown when a queued call exceeds its wait budget (fail fast, no silent stalls). */
export class QueueTimeoutError extends Error {
  readonly code = 'QUEUE_TIMEOUT'
  constructor(waitMs: number) {
    super(`bcrypt pool queue wait exceeded ${waitMs}ms`)
    this.name = 'QueueTimeoutError'
  }
}

/** Thrown when no slot can ever serve the call (all slots dead/retired). */
export class PoolExhaustedError extends Error {
  readonly code = 'POOL_EXHAUSTED'
  constructor() {
    super('bcrypt pool has no live worker slots')
    this.name = 'PoolExhaustedError'
  }
}

/** Crash-loop guard: a slot is respawned at most this many times. */
const MAX_RESPAWNS_PER_SLOT = 10

/** Default ceiling on how long a call may sit in the queue before rejection. */
const DEFAULT_MAX_WAIT_MS = 10_000

interface QueueEntry {
  task: BcryptTask
  pending: PendingCall
  /** Absolute deadline (Date.now() ms) after which the call is rejected. */
  expiresAt: number
}

export class BcryptPool {
  private readonly handles: WorkerHandle[] = []
  /** taskId -> call, across all workers (lookup by message id). */
  private readonly pending = new Map<number, PendingCall>()
  private queue: QueueEntry[] = []
  private nextTaskId = 1
  private disposed = false
  private sweepTimer: NodeJS.Timeout | null = null

  constructor(
    size: number,
    private readonly rounds: number,
    private readonly maxQueueDepth = 256,
    private readonly maxWaitMs = DEFAULT_MAX_WAIT_MS,
  ) {
    const poolSize = Math.max(1, Math.min(size, os.availableParallelism() * 2))
    for (let i = 0; i < poolSize; i += 1) {
      this.handles.push(this.spawn())
    }
  }

  private spawn(): WorkerHandle {
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: { bcryptPath: bcryptModulePath },
    })
    const handle: WorkerHandle = { worker, busy: false, inflight: new Set(), respawns: 0, dead: false }
    worker.on('message', (message: { id: number; ok: boolean; result?: string | boolean; error?: string }) => {
      handle.busy = false
      handle.inflight.delete(message.id)
      const call = this.pending.get(message.id)
      this.pending.delete(message.id)
      this.drain()
      if (!call) return
      if (message.ok) call.resolve(message.result as string | boolean)
      else call.reject(new Error(message.error ?? 'bcrypt worker failure'))
    })
    worker.on('error', (err: Error) => {
      // Crash containment (review follow-up): fail ONLY the tasks dispatched
      // to this worker, then respawn the slot so the pool keeps serving.
      // The pre-fix code set disposed=true and rejected every pending call
      // in the process, permanently bricking the pool after one crash.
      for (const id of handle.inflight) {
        const call = this.pending.get(id)
        this.pending.delete(id)
        call?.reject(err)
      }
      handle.inflight.clear()
      handle.busy = false
      if (this.disposed) return
      if (handle.respawns >= MAX_RESPAWNS_PER_SLOT) {
        // Crash loop: retire this slot instead of burning CPU respawning.
        handle.dead = true
      } else {
        const replacement = this.spawn()
        replacement.respawns = handle.respawns + 1
        const index = this.handles.indexOf(handle)
        if (index >= 0) this.handles[index] = replacement
      }
      this.drain()
    })
    return handle
  }

  private dispatch(handle: WorkerHandle, task: BcryptTask, pending: PendingCall): void {
    handle.busy = true
    const id = this.nextTaskId
    this.nextTaskId += 1
    this.pending.set(id, pending)
    handle.inflight.add(id)
    handle.worker.postMessage({ id, ...task })
  }

  private drain(): void {
    if (this.disposed) return
    while (this.queue.length > 0) {
      const handle = this.handles.find((candidate) => !candidate.busy && !candidate.dead)
      if (!handle) return
      const next = this.queue.shift()
      if (!next) return
      this.dispatch(handle, next.task, next.pending)
    }
  }

  /**
   * Rejects queued calls whose wait budget ran out and arms/unarms the
   * periodic sweep accordingly. Bounds both memory AND latency: a caller
   * never waits longer than maxWaitMs for a slot.
   */
  private reapExpired(): void {
    if (this.queue.length === 0) {
      if (this.sweepTimer !== null) {
        clearInterval(this.sweepTimer)
        this.sweepTimer = null
      }
      return
    }
    const nowMs = Date.now()
    const remaining: QueueEntry[] = []
    for (const entry of this.queue) {
      if (nowMs >= entry.expiresAt) entry.pending.reject(new QueueTimeoutError(this.maxWaitMs))
      else remaining.push(entry)
    }
    this.queue = remaining
    if (this.queue.length > 0 && this.sweepTimer === null) {
      // Check at a fraction of the wait budget so rejections land close to
      // their deadline even when no drain event fires.
      this.sweepTimer = setInterval(() => this.reapExpired(), Math.max(50, Math.floor(this.maxWaitMs / 4)))
      this.sweepTimer.unref?.()
    } else if (this.queue.length === 0) {
      this.reapExpired()
    }
  }

  private submit(task: BcryptTask): Promise<string | boolean> {
    if (this.disposed) return Promise.reject(new Error('bcrypt pool is not available'))
    if (this.handles.every((candidate) => candidate.dead)) {
      // No slot can ever serve this call: reject now instead of queueing
      // into a queue nobody will ever drain (review round 2).
      return Promise.reject(new PoolExhaustedError())
    }
    return new Promise((resolve, reject) => {
      if (this.queue.length >= this.maxQueueDepth) {
        // Fail fast rather than accepting unbounded memory growth under load.
        reject(new QueueFullError())
        return
      }
      const pending: PendingCall = { resolve, reject }
      const handle = this.handles.find((candidate) => !candidate.busy && !candidate.dead)
      if (handle) {
        this.dispatch(handle, task, pending)
      } else {
        this.queue.push({ task, pending, expiresAt: Date.now() + this.maxWaitMs })
        // Arm the latency bound: the queue may now hold a call that could
        // otherwise wait forever if every slot died right after enqueueing.
        this.reapExpired()
      }
    })
  }

  /** Hashes a password with the configured cost factor (off the event loop). */
  hashPassword(password: string, rounds = this.rounds): Promise<string> {
    return this.submit({ op: 'hash', password, rounds }) as Promise<string>
  }

  /** Verifies a password against a stored hash (off the event loop). */
  verifyPassword(password: string, hash: string): Promise<boolean> {
    return this.submit({ op: 'compare', password, hash }) as Promise<boolean>
  }

  /**
   * Terminates all workers; the pool must not be used afterwards. Queued
   * and in-flight calls are rejected with a dispose error.
   */
  async dispose(): Promise<void> {
    this.disposed = true
    if (this.sweepTimer !== null) {
      clearInterval(this.sweepTimer)
      this.sweepTimer = null
    }
    const error = new Error('bcrypt pool disposed')
    for (const call of this.pending.values()) call.reject(error)
    this.pending.clear()
    for (const entry of this.queue) entry.pending.reject(error)
    this.queue.length = 0
    await Promise.allSettled(this.handles.map((handle) => handle.worker.terminate()))
  }

  /**
   * Test hook: simulates a worker crash (the pool's own 'error' listener
   * runs, without spinning a real faulty worker). Deliberately narrow and
   * named so it never looks like production API.
   */
  simulateWorkerCrash(slot: number, err: Error): void {
    const handle = this.handles[slot]
    if (!handle) throw new Error(`no worker at slot ${slot}`)
    handle.worker.emit('error', err)
  }

  /** Test hook: number of live (non-dead) slots. */
  liveSlotCount(): number {
    return this.handles.filter((handle) => !handle.dead).length
  }
}
