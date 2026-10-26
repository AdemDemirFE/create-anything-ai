/**
 * Algorithm workbench tests: fixed catalog + effective bound advertised by
 * the ENGINE, tighten-only config clamp, bounded input, safe output,
 * measured duration separate from the static complexity note, unknown id,
 * multibyte round-trip, and the no-code-execution source scan.
 */
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Test } from '@nestjs/testing'
import { ConfigService } from '@nestjs/config'
import { AlgorithmEngine } from '../src/algorithm.engine.js'
import { closeTestApp, getTestApp, http, registerUser, cookieHeader } from './helpers.js'

beforeAll(async () => {
  await getTestApp()
})

afterAll(async () => {
  await closeTestApp()
})

describe('catalog + engine bound (contract)', () => {
  it('GET /algorithm returns the fixed catalog and the engine bound', async () => {
    const response = await http().get('/api/v1/algorithm')
    expect(response.status).toBe(200)
    expect(response.body.ok).toBe(true)
    const ids = (response.body.data.algorithms as Array<{ id: string }>).map((a) => a.id).sort()
    expect(ids).toEqual(['fizzbuzz', 'palindrome', 'reverse', 'word-count'])
    expect(response.body.data.maxInputLength).toBe(10_000)
    for (const entry of response.body.data.algorithms as Array<{ complexity: string; explanation: string }>) {
      expect(typeof entry.complexity).toBe('string')
      expect(typeof entry.explanation).toBe('string')
    }
  })

  it('the engine is the single source of truth: a tightened config bound shows up in the catalog AND is enforced by run()', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        AlgorithmEngine,
        { provide: ConfigService, useValue: { get: (key: string) => (key === 'algorithm.maxInput' ? 250 : undefined) } },
      ],
    }).compile()
    const engine = moduleRef.get(AlgorithmEngine)
    expect(engine.maxInput).toBe(250)
    expect(engine.catalog()).toHaveLength(4)

    expect(() => engine.run('reverse', 'a'.repeat(250))).not.toThrow()
    expect(() => engine.run('reverse', 'a'.repeat(251))).toThrowError(/maximum of 250/)
  })

  it('invalid/loosening config values clamp tighten-only back to the default', async () => {
    const make = async (configured: number): Promise<AlgorithmEngine> => {
      const moduleRef = await Test.createTestingModule({
        providers: [
          AlgorithmEngine,
          { provide: ConfigService, useValue: { get: (key: string) => (key === 'algorithm.maxInput' ? configured : undefined) } },
        ],
      }).compile()
      return moduleRef.get(AlgorithmEngine)
    }
    expect((await make(AlgorithmEngine.ABSOLUTE_MAX_INPUT_LENGTH + 1)).maxInput).toBe(AlgorithmEngine.MAX_INPUT_LENGTH)
    expect((await make(0)).maxInput).toBe(AlgorithmEngine.MAX_INPUT_LENGTH)
    expect((await make(-5)).maxInput).toBe(AlgorithmEngine.MAX_INPUT_LENGTH)
    expect((await make(Number.NaN)).maxInput).toBe(AlgorithmEngine.MAX_INPUT_LENGTH)
    expect((await make(128)).maxInput).toBe(128)
  })
})

describe('run', () => {
  it('reverses a string and returns measured duration separate from the static complexity', async () => {
    const response = await http().post('/api/v1/algorithm/run').send({ algorithmId: 'reverse', input: 'hello' })
    expect(response.status).toBe(200)
    expect(response.body.data.output).toBe('olleh')
    expect(typeof response.body.data.executionMs).toBe('number')
    expect(response.body.data.complexity).toBe('O(n)')
    expect(typeof response.body.data.explanation).toBe('string')
  })

  it('reverse is code-point safe for multibyte UTF-8', async () => {
    const response = await http().post('/api/v1/algorithm/run').send({ algorithmId: 'reverse', input: 'ünïcødé' })
    expect(response.status).toBe(200)
    expect(response.body.data.output).toBe('édøcïnü')
  })

  it('palindrome detection ignores non-alphanumerics and case', async () => {
    const yes = await http().post('/api/v1/algorithm/run').send({ algorithmId: 'palindrome', input: 'A man, a plan, a canal: Panama!' })
    expect(yes.body.data.output).toBe('true')
    const no = await http().post('/api/v1/algorithm/run').send({ algorithmId: 'palindrome', input: 'hello world' })
    expect(no.body.data.output).toBe('false')
    const empty = await http().post('/api/v1/algorithm/run').send({ algorithmId: 'palindrome', input: '!!!' })
    expect(empty.body.data.output).toBe('false')
  })

  it('word-count counts whitespace-separated words', async () => {
    const response = await http().post('/api/v1/algorithm/run').send({ algorithmId: 'word-count', input: 'one  two\tthree\nfour' })
    expect(response.body.data.output).toBe('4')
  })

  it('fizzbuzz handles bounds and rejects out-of-range input', async () => {
    const response = await http().post('/api/v1/algorithm/run').send({ algorithmId: 'fizzbuzz', input: '15' })
    const lines = (response.body.data.output as string).split('\n')
    expect(lines).toHaveLength(15)
    expect(lines[14]).toBe('FizzBuzz')
    expect(lines[2]).toBe('Fizz')
    expect(lines[4]).toBe('Buzz')

    const zero = await http().post('/api/v1/algorithm/run').send({ algorithmId: 'fizzbuzz', input: '0' })
    expect(zero.status).toBe(400)
    expect(zero.body.error.code).toBe('VALIDATION_ERROR')
    const huge = await http().post('/api/v1/algorithm/run').send({ algorithmId: 'fizzbuzz', input: '1001' })
    expect(huge.status).toBe(400)
  })

  it('unknown algorithm id -> 400 UNKNOWN_ALGORITHM', async () => {
    const response = await http().post('/api/v1/algorithm/run').send({ algorithmId: 'rm -rf /', input: 'anything' })
    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('UNKNOWN_ALGORITHM')
  })

  it('oversized input -> 400 INPUT_TOO_LARGE with the bound in the message; at-cap accepted', async () => {
    const atCap = await http().post('/api/v1/algorithm/run').send({ algorithmId: 'reverse', input: 'a'.repeat(10_000) })
    expect(atCap.status).toBe(200)
    const over = await http().post('/api/v1/algorithm/run').send({ algorithmId: 'reverse', input: 'a'.repeat(10_001) })
    expect(over.status).toBe(400)
    expect(over.body.error.code).toBe('INPUT_TOO_LARGE')
    expect(over.body.error.message).toContain('10000')
  })

  it('input is DATA, never executed (source scan: no evaluation or process primitives in the engine)', () => {
    // vitest runs with the server package as cwd; the relative path avoids
    // import.meta (disallowed in CommonJS-emitting files).
    const source = readFileSync('src/algorithm.engine.ts', 'utf8')
    for (const primitive of ['eval(', 'new Function', 'child_process', 'exec(', 'spawn', 'require(', 'import(']) {
      expect(source.includes(primitive)).toBe(false)
    }
  })

  it('the run endpoint is usable without a session (public screen) but still bounded', async () => {
    const response = await http().post('/api/v1/algorithm/run').send({ algorithmId: 'reverse', input: 'abc' })
    expect(response.status).toBe(200)
  })
})

describe('algorithm + session interplay', () => {
  it('a logged-in user can run algorithms with their session cookie present', async () => {
    const user = await registerUser()
    const response = await http()
      .post('/api/v1/algorithm/run')
      .set('cookie', cookieHeader(user.cookies))
      .send({ algorithmId: 'reverse', input: 'session' })
    expect(response.status).toBe(200)
    expect(response.body.data.output).toBe('noisses')
  })
})
