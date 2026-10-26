/**
 * PasswordService — scrypt (N=2^15, r=8, p=1) with a per-password random
 * salt, timing-safe comparison, and a configurable worker-thread pool so
 * heavy KDF work never blocks the event loop under concurrent load.
 *
 * scrypt is chosen over bcrypt because it ships with Node (no native
 * dependency) and its memory-hardness is the modern default; the pool
 * pattern (stack-18 review lesson) keeps concurrency bounded.
 */
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Worker } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const KEYLEN = 64
const PARAMS = { N: 2 ** 15, r: 8, p: 1 } as const

interface HashJob {
  password: string
  salt: string
}

const workerCode = `
const { scrypt, timingSafeEqual } = require('node:crypto')
const { parentPort } = require('node:worker_threads')
// maxmem: OpenSSL's default 32MB cap rejects N=2^15/r=8 (~33MB); raise it.
const options = { N: ${PARAMS.N}, r: ${PARAMS.r}, p: ${PARAMS.p}, maxmem: 128 * 1024 * 1024 }
parentPort.on('message', ({ password, salt, hash, verify }) => {
  try {
    if (verify) {
      const expected = Buffer.from(hash, 'hex')
      scrypt(password, salt, expected.length, options, (err, derived) => {
        if (err) return parentPort.postMessage({ ok: false, error: String(err && err.message || err) })
        const ok = derived.length === expected.length && timingSafeEqual(derived, expected)
        parentPort.postMessage({ ok: true, value: ok })
      })
    } else {
      scrypt(password, salt, ${KEYLEN}, options, (err, derived) => {
        if (err) return parentPort.postMessage({ ok: false, error: String(err && err.message || err) })
        parentPort.postMessage({ ok: true, value: derived.toString('hex') })
      })
    }
  } catch (err) {
    parentPort.postMessage({ ok: false, error: String(err && err.message || err) })
  }
})
`

@Injectable()
export class PasswordService implements OnModuleDestroy {
  private readonly workers: Worker[] = []
  private readonly maxWorkers: number
  private next = 0

  constructor(@Inject(ConfigService) config: ConfigService) {
    this.maxWorkers = Math.max(2, Math.min(4, config.get<number>('password.workers', 4)))
    for (let i = 0; i < this.maxWorkers; i += 1) {
      this.workers.push(new Worker(workerCode, { eval: true }))
    }
  }

  private run<T>(job: HashJob & { verify?: boolean; hash?: string }): Promise<T> {
    const worker = this.workers[this.next % this.workers.length]
    this.next += 1
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('password worker timed out'))
      }, 30_000)
      worker.once('message', (msg: { ok: boolean; value?: T; error?: string }) => {
        clearTimeout(timeout)
        if (msg.ok) resolve(msg.value as T)
        else reject(new Error(msg.error ?? 'password worker failed'))
      })
      worker.postMessage(job)
    })
  }

  async hash(password: string): Promise<string> {
    const salt = randomBytes(16).toString('hex')
    const digest = await this.run<string>({ password, salt })
    return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt}$${digest}`
  }

  async verify(password: string, stored: string): Promise<boolean> {
    const parts = stored.split('$')
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false
    const [, nStr, rStr, pStr, salt, digest] = parts
    const N = Number.parseInt(nStr ?? '', 10)
    const r = Number.parseInt(rStr ?? '', 10)
    const p = Number.parseInt(pStr ?? '', 10)
    if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p) || !salt || !digest) return false
    try {
      return await this.run<boolean>({ password, salt, verify: true, hash: digest })
    } catch {
      return false
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled(this.workers.map((w) => w.terminate()))
  }
}
