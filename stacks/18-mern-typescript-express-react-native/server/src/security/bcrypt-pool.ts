/**
 * Off-the-loop bcrypt via a bounded `worker_threads` pool.
 *
 * Why: bcrypt (12 rounds) costs 100-300 ms of pure CPU. Running it on the
 * main thread would freeze every concurrent request. This module dispatches
 * hash/compare work to a fixed pool of worker threads (Node stdlib only, no
 * extra dependency) and awaits the result.
 *
 * The worker source is an eval'd string that `require`s bcryptjs through an
 * absolute path passed via workerData — no worker file on disk, so it works
 * identically under vitest, tsx and compiled dist output.
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
}

export class BcryptPool {
  private readonly handles: WorkerHandle[] = []
  private readonly pending = new Map<number, PendingCall>()
  private readonly queue: Array<{ task: BcryptTask; pending: PendingCall }> = []
  private nextTaskId = 1
  private disposed = false

  constructor(
    size: number,
    private readonly rounds: number,
  ) {
    const poolSize = Math.max(1, Math.min(size, os.availableParallelism() * 2))
    for (let i = 0; i < poolSize; i += 1) {
      const worker = new Worker(WORKER_SOURCE, {
        eval: true,
        workerData: { bcryptPath: bcryptModulePath },
      })
      const handle: WorkerHandle = { worker, busy: false }
      worker.on('message', (message: { id: number; ok: boolean; result?: string | boolean; error?: string }) => {
        handle.busy = false
        const call = this.pending.get(message.id)
        this.pending.delete(message.id)
        this.drain()
        if (!call) return
        if (message.ok) call.resolve(message.result as string | boolean)
        else call.reject(new Error(message.error ?? 'bcrypt worker failure'))
      })
      worker.on('error', (err: Error) => {
        // Worker crashed: fail everything queued for it; the pool is broken.
        this.disposed = true
        for (const call of this.pending.values()) call.reject(err)
        this.pending.clear()
      })
      this.handles.push(handle)
    }
  }

  private dispatch(handle: WorkerHandle, task: BcryptTask, pending: PendingCall): void {
    handle.busy = true
    const id = this.nextTaskId
    this.nextTaskId += 1
    this.pending.set(id, pending)
    handle.worker.postMessage({ id, ...task })
  }

  private drain(): void {
    if (this.disposed) return
    while (this.queue.length > 0) {
      const handle = this.handles.find((candidate) => !candidate.busy)
      if (!handle) return
      const next = this.queue.shift()
      if (!next) return
      this.dispatch(handle, next.task, next.pending)
    }
  }

  private submit(task: BcryptTask): Promise<string | boolean> {
    if (this.disposed) return Promise.reject(new Error('bcrypt pool is not available'))
    return new Promise((resolve, reject) => {
      const pending: PendingCall = { resolve, reject }
      const handle = this.handles.find((candidate) => !candidate.busy)
      if (handle) {
        this.dispatch(handle, task, pending)
      } else {
        this.queue.push({ task, pending })
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

  /** Terminates all workers; the pool must not be used afterwards. */
  async dispose(): Promise<void> {
    this.disposed = true
    const error = new Error('bcrypt pool disposed')
    for (const call of this.pending.values()) call.reject(error)
    this.pending.clear()
    this.queue.length = 0
    await Promise.allSettled(this.handles.map((handle) => handle.worker.terminate()))
  }
}
