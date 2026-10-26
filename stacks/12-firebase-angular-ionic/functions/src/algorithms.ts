/**
 * Fixed, bounded, safe algorithm catalog — the only runnable code (PRD §6
 * Algorithm workbench). Hard-coded mapping; user input is always DATA, never
 * code. Each entry carries its theoretical Big-O, which the UI displays
 * separately from the measured wall-clock duration.
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

function runWordCount(input: string): string {
  const words = input.split(/\s+/).filter((w) => w.length > 0)
  return String(words.length)
}

function runDedupe(input: string): string {
  const seen = new Set<string>()
  for (const word of input.split(/\s+/)) {
    if (word.length > 0) seen.add(word)
  }
  return [...seen].join(' ')
}

function runCaesar(input: string): string {
  // First line: shift (1..25). Second line: text.
  const [shiftLine, ...rest] = input.split('\n')
  const shift = Number.parseInt((shiftLine ?? '').trim(), 10)
  if (!Number.isFinite(shift) || shift < 1 || shift > 25) {
    throw new Error('first line must be a shift between 1 and 25')
  }
  const text = rest.join('\n')
  let out = ''
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    if (code >= 65 && code <= 90) out += String.fromCharCode(((code - 65 + shift) % 26) + 65)
    else if (code >= 97 && code <= 122) out += String.fromCharCode(((code - 97 + shift) % 26) + 97)
    else out += ch
  }
  return out
}

export const CATALOG: Readonly<Record<string, AlgorithmSpec>> = Object.freeze({
  fizzbuzz: {
    id: 'fizzbuzz',
    name: 'FizzBuzz (1..n)',
    complexity: 'O(n)',
    explanation: 'Single pass from 1 to n; constant work per number.',
    run: runFizzBuzz,
  },
  reverse: {
    id: 'reverse',
    name: 'Reverse text',
    complexity: 'O(n)',
    explanation: 'Copies the input once, emitting characters last-to-first.',
    run: runReverse,
  },
  'word-count': {
    id: 'word-count',
    name: 'Word count',
    complexity: 'O(n)',
    explanation: 'Splits on whitespace and counts non-empty tokens in one pass.',
    run: runWordCount,
  },
  dedupe: {
    id: 'dedupe',
    name: 'Dedupe words (stable)',
    complexity: 'O(n)',
    explanation: 'Set membership test per token; preserves first-seen order.',
    run: runDedupe,
  },
  caesar: {
    id: 'caesar',
    name: 'Caesar shift',
    complexity: 'O(n)',
    explanation: 'One arithmetic op per character after the shift is parsed.',
    run: runCaesar,
  },
})

export function listAlgorithms(): AlgorithmSpec[] {
  return Object.values(CATALOG)
}

export function getAlgorithm(id: unknown): AlgorithmSpec | undefined {
  if (typeof id !== 'string') return undefined
  return Object.prototype.hasOwnProperty.call(CATALOG, id) ? CATALOG[id] : undefined
}
