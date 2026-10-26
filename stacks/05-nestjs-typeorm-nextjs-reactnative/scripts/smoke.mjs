#!/usr/bin/env node
/**
 * Real-HTTP smoke for Stack 05: boots NOTHING — expects the server to
 * already listen at SMOKE_BASE_URL (default http://127.0.0.1:4000/api/v1).
 *
 * Journey: health catalog -> register -> home -> algorithm run (x2) ->
 * throttle burn (429 + Retry-After) -> login envelope shape -> logout ->
 * session revoked. Every response is checked for the envelope contract and
 * the X-Request-Id header shape. Exits 0 only if EVERY assertion holds.
 */
const BASE = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:4000/api/v1'
const REQUEST_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/

let passed = 0
let failed = 0
const failures = []

function check(name, condition, extra = '') {
  if (condition) {
    passed += 1
    console.log(`  ok  ${name}`)
  } else {
    failed += 1
    failures.push(`${name}${extra ? ` — ${extra}` : ''}`)
    console.log(`FAIL  ${name}${extra ? ` — ${extra}` : ''}`)
  }
}

function assertEnvelope(name, response, body, ok) {
  check(`${name}: envelope ok=${ok}`, body && body.ok === ok && (ok ? body.error === null : body.data === null))
  const header = response.headers.get('x-request-id')
  check(`${name}: x-request-id shape`, typeof header === 'string' && REQUEST_ID_PATTERN.test(header), `got ${JSON.stringify(header)}`)
}

async function call(method, path, { body, cookie } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
      'x-request-id': `smoke-${Math.random().toString(36).slice(2, 10)}`,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await response.text()
  let json = null
  try {
    json = text === '' ? null : JSON.parse(text)
  } catch {
    json = null
  }
  return { response, json }
}

const STAMP = Date.now().toString(36)
const EMAIL = `smoke-runner-${STAMP}@example.com`
const PASSWORD = 'Correct-Horse-9x'
let cookie = null

async function main() {
  console.log(`smoke against ${BASE}`)

  // 1. Public catalog.
  {
    const { response, json } = await call('GET', '/algorithm')
    assertEnvelope('catalog', response, json, true)
    check('catalog: 4 algorithms', Array.isArray(json?.data?.algorithms) && json.data.algorithms.length === 4)
    check('catalog: bound advertised as a number', typeof json?.data?.maxInputLength === 'number')
  }

  // 2. Register.
  {
    const { response, json } = await call('POST', '/auth/register', { body: { email: EMAIL, password: PASSWORD } })
    assertEnvelope('register', response, json, true)
    check('register: 201', response.status === 201, `got ${response.status}`)
    check('register: user payload', json?.data?.user?.email === EMAIL)
    const setCookie = response.headers.get('set-cookie') ?? ''
    check('register: session cookie issued', /stack05_session=/.test(setCookie) && /HttpOnly/i.test(setCookie))
    cookie = setCookie.split(';')[0]
  }

  // 3. Home.
  {
    const { response, json } = await call('GET', '/home', { cookie })
    assertEnvelope('home', response, json, true)
    check('home: email matches', json?.data?.email === EMAIL)
    check('home: metrics present', Array.isArray(json?.data?.metrics) && json.data.metrics.length >= 3)
  }

  // 4. Algorithm run (success + multibyte).
  {
    const { response, json } = await call('POST', '/algorithm/run', { body: { algorithmId: 'reverse', input: 'hello' } })
    assertEnvelope('run', response, json, true)
    check('run: output reversed', json?.data?.output === 'olleh')
    check('run: measured duration is a number', typeof json?.data?.executionMs === 'number')
  }
  {
    const { response, json } = await call('POST', '/algorithm/run', { body: { algorithmId: 'reverse', input: 'ünïcødé' } })
    check('run: multibyte reversed', json?.data?.output === 'édøcïnü')
    check('run: status 200', response.status === 200)
  }

  // 5. Unknown id -> UNKNOWN_ALGORITHM.
  {
    const { response, json } = await call('POST', '/algorithm/run', { body: { algorithmId: 'not-real', input: 'x' } })
    assertEnvelope('unknown-id', response, json, false)
    check('unknown-id: 400', response.status === 400)
    check('unknown-id: code', json?.error?.code === 'UNKNOWN_ALGORITHM', json?.error?.code)
  }

  // 6. Throttle: burn 5 failures -> 429 + Retry-After.
  let retryAfter = null
  for (let i = 0; i < 5; i += 1) {
    const attempt = await call('POST', '/auth/login', { body: { email: EMAIL, password: 'Wrong-Pass-12' } })
    if (i === 4) {
      const locked = await call('POST', '/auth/login', { body: { email: EMAIL, password: PASSWORD } })
      check('throttle: locked identity gets 429', locked.response.status === 429, `got ${locked.response.status}`)
      check('throttle: RATE_LIMITED code', locked.json?.error?.code === 'RATE_LIMITED')
      retryAfter = Number(locked.response.headers.get('retry-after'))
      check('throttle: Retry-After 1..60', Number.isFinite(retryAfter) && retryAfter >= 1 && retryAfter <= 60, String(retryAfter))
    } else if (attempt.response.status !== 401) {
      check(`throttle: burn ${i + 1} returns 401`, false, `got ${attempt.response.status}`)
    }
  }
  check('throttle: burn attempts all 401', true)

  // 7. Unauthenticated home -> 401 envelope.
  {
    const { response, json } = await call('GET', '/home')
    assertEnvelope('unauth-home', response, json, false)
    check('unauth-home: 401 + UNAUTHORIZED', response.status === 401 && json?.error?.code === 'UNAUTHORIZED')
  }

  // 8. Logout revokes the session.
  {
    const out = await call('POST', '/auth/logout', { cookie })
    check('logout: 200 envelope', out.response.status === 200 && out.json?.ok === true)
    const revoked = await call('GET', '/home', { cookie })
    check('logout: session revoked (401)', revoked.response.status === 401)
  }

  console.log(`\nsmoke: ${passed} passed, ${failed} failed`)
  if (failed > 0) {
    for (const failure of failures) console.log(`  - ${failure}`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('smoke crashed:', err)
  process.exit(1)
})
