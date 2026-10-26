/**
 * AlgorithmEngine — the fixed-catalog workbench. SAFETY CONTRACT:
 *   - the catalog is FIXED code; user input is DATA, never evaluated
 *     (no dynamic evaluation or process-execution primitives anywhere —
 *     pinned by a source-scan test),
 *   - input is bounded: the effective bound is resolved from config with a
 *     tighten-only clamp (never above ABSOLUTE_MAX_INPUT_LENGTH; invalid
 *     values fall back to the default) — the engine is the single source of
 *     truth for the bound, and both /api/v1 and the UI advertise the same
 *     number (contract-tested),
 *   - measured duration (hrtime, monotonic) is returned separately from the
 *     static Big-O note.
 */
import { Injectable } from '@nestjs/common'
import { Inject } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ApiError } from './api-error.js'
import { ERROR_CODES } from './error-codes.js'

export interface CatalogEntry {
  id: string
  name: string
  complexity: string
  explanation: string
}

const CATALOG: CatalogEntry[] = [
  {
    id: 'reverse',
    name: 'Reverse string',
    complexity: 'O(n)',
    explanation: 'Walks the input once and emits characters in reverse order.',
  },
  {
    id: 'word-count',
    name: 'Word count',
    complexity: 'O(n)',
    explanation: 'Counts whitespace-separated words in a single pass.',
  },
  {
    id: 'fizzbuzz',
    name: 'FizzBuzz (bounded)',
    complexity: 'O(n)',
    explanation: 'Prints FizzBuzz-style output for numbers 1..n, n capped at 1000.',
  },
  {
    id: 'palindrome',
    name: 'Palindrome check',
    complexity: 'O(n)',
    explanation: 'Checks whether letters and digits read the same in both directions.',
  },
]

@Injectable()
export class AlgorithmEngine {
  /** Fallback input bound (characters); the effective bound is configurable. */
  static readonly MAX_INPUT_LENGTH = 10_000
  /** Hard ceiling for the configured bound (tighten-only safety net). */
  static readonly ABSOLUTE_MAX_INPUT_LENGTH = 100_000

  private readonly maxInputLength: number

  constructor(@Inject(ConfigService) config: ConfigService) {
    const configured = config.get<number>('algorithm.maxInput', AlgorithmEngine.MAX_INPUT_LENGTH) ?? AlgorithmEngine.MAX_INPUT_LENGTH
    // Tighten-only: deployments may LOWER the bound via ALGORITHM_MAX_INPUT,
    // never raise it above the absolute ceiling; garbage falls back.
    this.maxInputLength =
      Number.isFinite(configured) && configured >= 1 && configured <= AlgorithmEngine.ABSOLUTE_MAX_INPUT_LENGTH
        ? Math.floor(configured)
        : AlgorithmEngine.MAX_INPUT_LENGTH
  }

  /** The effective input bound this engine enforces (single source of truth). */
  get maxInput(): number {
    return this.maxInputLength
  }

  catalog(): CatalogEntry[] {
    return CATALOG.map((entry) => ({ ...entry }))
  }

  run(id: string, input: string): { algorithmId: string; output: string; executionMs: number; complexity: string; explanation: string } {
    const entry = CATALOG.find((candidate) => candidate.id === id)
    if (!entry) {
      throw new ApiError(ERROR_CODES.UNKNOWN_ALGORITHM, 'Unknown algorithm id.', 400)
    }
    if (input.length > this.maxInputLength) {
      throw new ApiError(
        ERROR_CODES.INPUT_TOO_LARGE,
        `Input exceeds the maximum of ${this.maxInputLength} characters.`,
        400,
      )
    }

    const started = process.hrtime.bigint()
    const output = this.execute(id, input)
    const executionMs = Number(process.hrtime.bigint() - started) / 1e6

    return {
      algorithmId: id,
      output,
      executionMs: Math.round(executionMs * 1000) / 1000,
      complexity: entry.complexity,
      explanation: entry.explanation,
    }
  }

  private execute(id: string, input: string): string {
    switch (id) {
      case 'reverse':
        // Code-point safe (Array.from splits by code points, not UTF-16 units).
        return Array.from(input).reverse().join('')
      case 'word-count':
        return String(input.split(/\s+/).filter((word) => word !== '').length)
      case 'fizzbuzz': {
        const bound = this.parseBound(input)
        const lines: string[] = []
        for (let i = 1; i <= bound; i += 1) {
          const fizz = i % 3 === 0
          const buzz = i % 5 === 0
          lines.push(fizz && buzz ? 'FizzBuzz' : fizz ? 'Fizz' : buzz ? 'Buzz' : String(i))
        }
        return lines.join('\n')
      }
      case 'palindrome': {
        const normalized = input.toLowerCase().replace(/[^a-z0-9]/g, '')
        if (normalized === '') return 'false'
        const reversed = Array.from(normalized).reverse().join('')
        return normalized === reversed ? 'true' : 'false'
      }
      default:
        throw new ApiError(ERROR_CODES.UNKNOWN_ALGORITHM, 'Unknown algorithm id.', 400)
    }
  }

  private parseBound(input: string): number {
    const trimmed = input.trim()
    if (!/^\d{1,4}$/.test(trimmed)) {
      throw new ApiError(ERROR_CODES.VALIDATION_ERROR, 'FizzBuzz needs a whole number between 1 and 1000.', 400, [
        { field: 'input', code: 'INVALID_NUMBER', message: 'Enter a number between 1 and 1000.' },
      ])
    }
    const value = Number.parseInt(trimmed, 10)
    if (value < 1 || value > 1000) {
      throw new ApiError(ERROR_CODES.VALIDATION_ERROR, 'FizzBuzz needs a whole number between 1 and 1000.', 400, [
        { field: 'input', code: 'OUT_OF_RANGE', message: 'Enter a number between 1 and 1000.' },
      ])
    }
    return value
  }
}
