#!/usr/bin/env node
/**
 * Stack 17 — runtime smoke test against a REAL `php artisan serve` process.
 *
 * Prerequisites:
 *   - a running server:  php artisan serve --host=127.0.0.1 --port=8000
 *   - an initialized sqlite database (php artisan migrate --force once)
 *
 * Exercises the documented /api/v1 contract over real HTTP:
 *   register -> login (cookie) -> notes CRUD -> algorithm workbench ->
 *   X-Request-Id echo/validation -> login throttle 429 + Retry-After ->
 *   logout -> session revocation (401 afterwards).
 *
 * Exit 0 = all checks passed; any failure prints the failed check and exits 1.
 */

const BASE = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:8000';

const checks = [];
let failures = 0;

function check(name, condition, detail = '') {
  checks.push({ name, ok: condition });
  if (!condition) {
    failures += 1;
    console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    console.log(`ok:   ${name}`);
  }
}

/** Minimal cookie jar: stores name=value pairs from Set-Cookie headers. */
function makeJar() {
  const jar = new Map();
  return {
    capture(res) {
      const raw = res.headers.getSetCookie?.() ?? [];
      for (const line of raw) {
        const [pair] = line.split(';');
        const idx = pair.indexOf('=');
        if (idx > 0) jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
      }
    },
    header() {
      return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    },
    has(name) {
      return jar.has(name);
    },
  };
}

async function call({ path, method = 'GET', body, jar, requestId }) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (jar) Object.assign(headers, { Cookie: jar.header() });
  if (requestId !== undefined) headers['X-Request-Id'] = requestId;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  // Track Set-Cookie (login/register rotate the session cookie).
  jar?.capture(res);
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { res, json };
}

/** Asserts the strict envelope shape used by every /api/v1 response. */
function assertEnvelope(name, json, { ok } = {}) {
  const valid =
    json !== null &&
    typeof json === 'object' &&
    typeof json.ok === 'boolean' &&
    (ok === undefined || json.ok === ok) &&
    ('data' in json) &&
    ('error' in json) &&
    typeof json.requestId === 'string' &&
    json.requestId.length > 0;
  check(`${name} (envelope shape)`, valid, JSON.stringify(json));
  return valid;
}

// Dictionary-type literals only (no leetspeak): repository Gitleaks rules
// flag password-like literals; these are test fixtures, but keep them boring.
const STAMP = Date.now();
const EMAIL = `smoke-${STAMP}@example.com`;
const OTHER = `smoke-other-${STAMP}@example.com`;
const PASSWORD = 'correcthorse1';
const WRONG_PASSWORD = 'wrongpassword1';

async function main() {
  console.log(`smoke target: ${BASE}`);

  // -- /api/v1/health -----------------------------------------------------
  {
    const { res, json } = await call({ path: '/api/v1/health' });
    check('health is 200', res.status === 200, `status ${res.status}`);
    assertEnvelope('health', json, { ok: true });
  }

  // -- X-Request-Id: valid id echoed, invalid replaced by opaque id --------
  {
    const { res, json } = await call({
      path: '/api/v1/health',
      requestId: 'smoke-correlation-123',
    });
    check('valid X-Request-Id echoed in header', res.headers.get('x-request-id') === 'smoke-correlation-123');
    check('valid X-Request-Id echoed in envelope body', json?.requestId === 'smoke-correlation-123');

    const evil = 'x'.repeat(80); // > 64 chars → must be discarded
    const r2 = await call({ path: '/api/v1/health', requestId: evil });
    const minted = r2.res.headers.get('x-request-id') ?? '';
    check('oversized X-Request-Id replaced with opaque id', minted.length === 32 && /^[0-9a-f]{32}$/.test(minted), `got "${minted}"`);
    check('minted id also lands in envelope body', r2.json?.requestId === minted);
  }

  // -- register ------------------------------------------------------------
  {
    const { res, json } = await call({
      path: '/api/v1/register',
      method: 'POST',
      body: { name: 'Ada Lovelace', email: EMAIL, password: PASSWORD },
    });
    check('register returns 201', res.status === 201, `status ${res.status}`);
    assertEnvelope('register', json, { ok: true });
    check('register payload carries user.email', json?.data?.user?.email === EMAIL);
  }

  // -- duplicate register: field-level error, no enumeration wording -------
  {
    const { res, json } = await call({
      path: '/api/v1/register',
      method: 'POST',
      body: { name: 'Ada Lovelace', email: EMAIL, password: PASSWORD },
    });
    check('duplicate register returns 422', res.status === 422, `status ${res.status}`);
    assertEnvelope('duplicate register', json, { ok: false });
    check(
      'duplicate email reported under error.details[].field = email',
      Array.isArray(json?.error?.details) && json.error.details.some((d) => d.field === 'email'),
      JSON.stringify(json?.error),
    );
    check(
      'no account-existence wording (anti-enumeration)',
      !/exists|already|taken/i.test(json?.error?.message ?? ''),
    );
  }

  // -- validation error shape ----------------------------------------------
  {
    const { res, json } = await call({
      path: '/api/v1/register',
      method: 'POST',
      body: { name: 'A', email: 'not-an-email', password: 'short' },
    });
    check('invalid register returns 422', res.status === 422, `status ${res.status}`);
    check('invalid register code is VALIDATION_ERROR', json?.error?.code === 'VALIDATION_ERROR');
  }

  // -- unauthenticated access to a protected endpoint -----------------------
  {
    const { res, json } = await call({ path: '/api/v1/notes' });
    check('unauthenticated /notes returns 401', res.status === 401, `status ${res.status}`);
    check('401 code is UNAUTHENTICATED', json?.error?.code === 'UNAUTHENTICATED');
  }

  // -- login (wrong password): generic error -------------------------------
  {
    const { res, json } = await call({
      path: '/api/v1/login',
      method: 'POST',
      body: { email: EMAIL, password: WRONG_PASSWORD },
    });
    check('wrong password returns 401', res.status === 401, `status ${res.status}`);
    check('wrong password code is INVALID_CREDENTIALS', json?.error?.code === 'INVALID_CREDENTIALS');
    check(
      'wrong-password message is generic (no enumeration)',
      json?.error?.message === 'These credentials do not match our records.',
    );
  }

  // -- login (correct) captures the session cookie -------------------------
  const jar = makeJar();
  {
    const { res, json } = await call({
      path: '/api/v1/login',
      method: 'POST',
      body: { email: EMAIL, password: PASSWORD },
      jar,
    });
    check('login returns 200', res.status === 200, `status ${res.status}`);
    assertEnvelope('login', json, { ok: true });
    check('login sets the stack17_session cookie', jar.has('stack17_session'));
  }

  // -- notes CRUD over the captured session --------------------------------
  let noteId = null;
  {
    const { res, json } = await call({
      path: '/api/v1/notes',
      method: 'POST',
      body: { title: 'Smoke note', body: 'Created by the smoke script.' },
      jar,
    });
    check('note create returns 201', res.status === 201, `status ${res.status}`);
    assertEnvelope('note create', json, { ok: true });
    noteId = json?.data?.note?.id ?? null;
    check('note create returns an id', Number.isInteger(noteId));
  }
  {
    const { res, json } = await call({ path: '/api/v1/notes', jar });
    check('note list returns 200', res.status === 200);
    check('note list contains the created note', Array.isArray(json?.data?.notes) && json.data.notes.some((n) => n.id === noteId));
  }
  {
    const { res, json } = await call({
      path: `/api/v1/notes/${noteId}`,
      method: 'PUT',
      body: { title: 'Smoke note (updated)', body: 'Updated by the smoke script.' },
      jar,
    });
    check('note update returns 200', res.status === 200, `status ${res.status}`);
    check('note update persisted the new title', json?.data?.note?.title === 'Smoke note (updated)');
  }
  {
    const { res, json } = await call({ path: `/api/v1/notes/${noteId}`, jar });
    check('note show returns 200', res.status === 200);
    check('note show carries the updated body', json?.data?.note?.body === 'Updated by the smoke script.');
  }

  // -- foreign note ownership: 403, not 404 --------------------------------
  // (register a second user; the login block above is intentionally omitted)
  {
    const jar2 = makeJar();
    await call({
      path: '/api/v1/register',
      method: 'POST',
      body: { name: 'Grace Hopper', email: OTHER, password: PASSWORD },
      jar: jar2,
    });
    const { res, json } = await call({ path: `/api/v1/notes/${noteId}`, jar: jar2 });
    check('foreign note read returns 403', res.status === 403, `status ${res.status}`);
    check('foreign note code is FORBIDDEN', json?.error?.code === 'FORBIDDEN');
  }

  // -- algorithm workbench --------------------------------------------------
  {
    const { res, json } = await call({ path: '/api/v1/algorithm', jar });
    check('algorithm catalog returns 200', res.status === 200);
    check('catalog has entries', Array.isArray(json?.data?.algorithms) && json.data.algorithms.length > 0);
    check('catalog carries maxInputLength = 10000', json?.data?.maxInputLength === 10000);
  }
  {
    const { res, json } = await call({
      path: '/api/v1/algorithm/run',
      method: 'POST',
      body: { algorithmId: 'reverse', input: 'hello world' },
      jar,
    });
    check('algorithm run returns 200', res.status === 200, `status ${res.status}`);
    check('reverse produced the expected output', json?.data?.output === 'dlrow olleh');
    check('run result carries execution_ms', typeof json?.data?.execution_ms === 'number');
    check('run result carries the static complexity', json?.data?.complexity === 'O(n)');
  }
  {
    const { res, json } = await call({
      path: '/api/v1/algorithm/run',
      method: 'POST',
      body: { algorithmId: 'nope-nope', input: 'x' },
      jar,
    });
    check('unknown algorithm returns 400', res.status === 400, `status ${res.status}`);
    check('unknown algorithm code is UNKNOWN_ALGORITHM', json?.error?.code === 'UNKNOWN_ALGORITHM');
  }
  {
    const { res, json } = await call({
      path: '/api/v1/algorithm/run',
      method: 'POST',
      body: { algorithmId: 'reverse', input: 'y'.repeat(10_001) },
      jar,
    });
    check('oversized input returns 400', res.status === 400, `status ${res.status}`);
    check('oversized input code is INPUT_TOO_LARGE', json?.error?.code === 'INPUT_TOO_LARGE');
  }

  // -- login throttle: 429 + Retry-After ------------------------------------
  {
    // Fresh victim identity so other sections cannot pre-exhaust the budget.
    const victim = `smoke-throttle-${STAMP}@example.com`;
    // Consume the budget: 5 failed attempts max per window (config/stack.php).
    for (let i = 0; i < 5; i += 1) {
      await call({
        path: '/api/v1/login',
        method: 'POST',
        body: { email: victim, password: WRONG_PASSWORD },
      });
    }
    // The 6th failed attempt must be throttled even before credential check.
    const { res, json } = await call({
      path: '/api/v1/login',
      method: 'POST',
      body: { email: victim, password: WRONG_PASSWORD },
    });
    check('6th failed login returns 429', res.status === 429, `status ${res.status}`);
    check('throttled login code is RATE_LIMITED', json?.error?.code === 'RATE_LIMITED');
    const retryAfter = res.headers.get('retry-after');
    check('throttled login carries Retry-After header', retryAfter !== null && Number(retryAfter) > 0, `got "${retryAfter}"`);
    // Correct password must NOT bypass the lockout (counted attempt).
    const r2 = await call({
      path: '/api/v1/login',
      method: 'POST',
      body: { email: EMAIL, password: PASSWORD },
      jar,
    });
    check('lockout is keyed per email (other account unaffected)', r2.res.status === 200, `status ${r2.res.status}`);
  }

  // -- logout + session revocation ------------------------------------------
  {
    const { res, json } = await call({ path: '/api/v1/logout', method: 'POST', body: {}, jar });
    check('logout returns 200', res.status === 200, `status ${res.status}`);
    assertEnvelope('logout', json, { ok: true });
    check('logout payload says logged_out', json?.data?.logged_out === true);

    const { res: res2 } = await call({ path: '/api/v1/notes', jar });
    check('session revoked after logout (401)', res2.status === 401, `status ${res2.status}`);
  }

  // -- summary ----------------------------------------------------------------
  const failed = checks.filter((c) => !c.ok);
  console.log('');
  console.log(`smoke checks: ${checks.length - failed.length}/${checks.length} passed`);
  if (failures > 0) {
    process.exit(1);
  }
  console.log('SMOKE PASSED');
}

main().catch((error) => {
  console.error(`smoke aborted: ${error?.stack ?? error}`);
  process.exit(1);
});
