/**
 * Fixed, bounded, safe algorithm catalog — the only runnable code.
 *
 * Security model:
 * - Hard-coded mapping; there is NO code-execution path for user input.
 *   `input` is always treated as *data*.
 * - Input bounded at MAX_INPUT_LENGTH (enforced in the engine, defense in
 *   depth after the route-level bound).
 * - Each entry carries its theoretical Big-O, which the UI must display
 *   separately from the measured wall-clock duration (monotonic clock).
 */
export const MAX_INPUT_LENGTH = 10_000

export interface AlgorithmSpec {
  id: string
  name: string
  complexity: string
  explanation: string
  run: (input: string) => string
}

function runFizzBuzz(input: string): string {
  const n = Number.parseInt(input.trim(), 10)
  if (!Number.isFinite(n) || String(n) !== input.trim() || n < 1 || n > 1000) {
    throw new Error('n must be an integer between 1 and 1000')
  }
  const lines: string[] = []
  for (let i = 1; i <= n; i += 1) {
    if (i % 15 === 0) lines.push('FizzBuzz')
    else if (i % 3 === 0) lines.push('Fizz')
    else if (i % 5 === 0) lines.push('Buzz')
    else lines.push(String(i))
  }
  return lines.join('\n')
}

function runReverse(input: string): string {
  return [...input].reverse().join('')
}

function runPalindrome(input: string): string {
  const normalized = [...input.toLowerCase()].filter((ch) => /[a-z0-9]/.test(ch)).join('')
  const isPalindrome = normalized === [...normalized].reverse().join('')
  return `palindrome: ${isPalindrome}\nnormalized length: ${normalized.length}`
}

function runFibonacci(input: string): string {
  const n = Number.parseInt(input.trim(), 10)
  if (!Number.isFinite(n) || String(n) !== input.trim() || n < 1 || n > 90) {
    // Cap keeps iterative Fibonacci within Number.MAX_SAFE_INTEGER; the
    // bound is policy, not a complexity necessity.
    throw new Error('n must be an integer between 1 and 90')
  }
  const values: string[] = []
  let a = 0n
  let b = 1n
  for (let i = 0; i < n; i += 1) {
    values.push(a.toString())
    ;[a, b] = [b, a + b]
  }
  return values.join(',')
}

function runWordCount(input: string): string {
  const words = input.split(/\s+/).filter((word) => word.length > 0)
  const unique = new Set(words.map((word) => word.toLowerCase()))
  return `words: ${words.length}\nunique (case-insensitive): ${unique.size}`
}

export const CATALOG: Record<string, AlgorithmSpec> = {
  fizzbuzz: {
    id: 'fizzbuzz',
    name: 'FizzBuzz',
    complexity: 'O(n)',
    explanation: 'Builds one line per number from 1 to n; linear in output size.',
    run: runFizzBuzz,
  },
  reverse: {
    id: 'reverse',
    name: 'Reverse text',
    complexity: 'O(n)',
    explanation: 'Single reversed copy of the input string.',
    run: runReverse,
  },
  palindrome: {
    id: 'palindrome',
    name: 'Palindrome check',
    complexity: 'O(n)',
    explanation: 'Normalizes (alphanumeric, lowercased) then compares with its reverse.',
    run: runPalindrome,
  },
  fibonacci: {
    id: 'fibonacci',
    name: 'Fibonacci sequence (iterative)',
    complexity: 'O(n)',
    explanation: 'Iterative pairwise addition; no recursion, constant auxiliary space.',
    run: runFibonacci,
  },
  'word-count': {
    id: 'word-count',
    name: 'Word count',
    complexity: 'O(n)',
    explanation: 'Single pass over whitespace-separated words.',
    run: runWordCount,
  },
}

export class InputTooLargeError extends Error {
  constructor() {
    super('input too large')
  }
}

export function runAlgorithm(algorithmId: string, input: string): { output: string; spec: AlgorithmSpec } {
  if (typeof input !== 'string' || input.length > MAX_INPUT_LENGTH) {
    throw new InputTooLargeError()
  }
  const spec = CATALOG[algorithmId]
  if (!spec) {
    throw new UnknownAlgorithmError()
  }
  let output: string
  try {
    output = spec.run(input)
  } catch {
    throw new InvalidInputError()
  }
  return { output, spec }
}

export class UnknownAlgorithmError extends Error {
  constructor() {
    super('unknown algorithm')
  }
}

export class InvalidInputError extends Error {
  constructor() {
    super('invalid input')
  }
}
