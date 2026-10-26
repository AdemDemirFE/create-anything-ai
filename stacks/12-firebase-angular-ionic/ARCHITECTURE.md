# Architecture — Stack 12 (Firebase / Angular / Ionic)

## 1. Components

```
+------------------------------------------------------------------+
| Browser (Angular 19 SPA, Ionic 8 UI, @angular/build)             |
|                                                                  |
|  pages/  Login -> Register -> Home -> Algorithm / Documents      |
|     |    (consume the envelope; never see Firebase)              |
|     v                                                            |
|  auth/AuthService -> api/ApiClient   client-side envelope layer  |
|     |    (normalize fetch failures -> {ok,data,error,requestId}) |
|     v                                                            |
|  HttpOnly session cookie (stack12_session)                       |
+------------------------------------------------------------------+
               | HTTPS (production) / proxy (dev)
               v
+------------------------------------------------------------------+
| Cloud Functions v2 onRequest (europe-west1) — SAME Express app   |
|  envelope.ts   request-id echo + {ok,data,error,requestId}       |
|  throttle.ts   fixed-window login 429 + Retry-After              |
|  identity.ts   Auth emulator/production register + login         |
|  session.ts    opaque cookie token, SHA-256 digest in Firestore  |
|  documents.ts  users/{uid}/documents CRUD (Firestore)            |
|  algorithms.ts fixed bounded catalog (input = data, never code)  |
+------------------------------------------------------------------+
        |                                   |
        v                                   v
+------------------+            +--------------------------+
| Firebase Auth    |            | Firestore                |
| (emulator 9099 / |            | (emulator 8088 /         |
|  production)     |            |  production)             |
+------------------+            +--------------------------+
```

## 2. Wire envelope (documented deviation from PRD §7)

Every JSON response uses the envelope **all recent stacks in this repo ship**
(the BaaS stacks 08–11 document the same deviation):

```json
{ "ok": true,  "data": {...}, "error": null,  "requestId": "abc-123" }
{ "ok": false, "data": null,  "error": {...}, "requestId": "abc-123" }
```

- `requestId` = validated client `X-Request-Id` (regex `^[A-Za-z0-9-]{1,64}$`)
  or a fresh 32-hex id. Invalid client ids are **never echoed**.
- Error shape: `{ code, message, details? }` — stable codes in
  `functions/src/error-codes.ts`; provider-internal codes never surface.
- `X-Request-Id` response header always mirrors the body id.

## 3. Session model (PRD §6 Login)

- **Managed identity:** Firebase Auth stores credentials (scrypt) — this
  stack never handles raw password hashing. Register/login validate shape,
  then delegate to Auth (emulator locally, production service in deploy).
- **Verify credentials:** the server calls the identitytoolkit REST endpoint
  (`accounts:signInWithPassword`) — identical API on emulator and production —
  and then `admin.verifyIdToken(checkRevoked: true)`.
- **Session cookie:** after verification the server issues its OWN opaque
  32-byte CSPRNG token in an `HttpOnly; SameSite=Lax; Path=/` cookie
  (`Secure` when `SECURE_COOKIES=1`). Only the SHA-256 digest is stored
  (Firestore `sessions/{digest}`), so a DB read cannot resurrect a session.
- **Lifetime:** sliding idle TTL (`SESSION_TTL_MINUTES`, default 30); every
  successful `/home` re-anchors `expiresAt`. Expired sessions are rejected
  even before any sweep.
- **Revocation:** logout deletes the Firestore digest doc + clears the cookie.
- **CSRF:** the API accepts only `application/json` bodies and is
  SameSite=Lax-cookie gated; there are no cross-site form posts in this
  stack. (A cross-origin deployment must keep the CORS allowlist tight —
  `ALLOWED_ORIGINS`.)
- **Never logged:** passwords, tokens, cookies, authorization headers.

## 4. Email normalize-before-unique (rule 5)

`identity.ts#normalizeEmail` trims + lower-cases BEFORE any uniqueness path:

- Auth account is created with the normalized email.
- A Firestore unique-key doc `users/byEmail/keys/{normalized}` is
  `create()`d atomically — a duplicate register fails there, the orphan Auth
  user is deleted, and the SAME generic message (`Registration failed.`)
  is returned for every rejection reason (no enumeration).
- Login uses `getUserByEmail(normalized)` — `Ada@Example.com` and
  `ada@example.com` are the same account (tested).

## 5. Throttle (rule 3, config-driven)

`throttle.ts` — fixed window keyed by `(normalized email | peer IP)`:

| Knob | Env var | Default |
|---|---|---|
| Max failed attempts / window | `LOGIN_THROTTLE_MAX_ATTEMPTS` | 5 |
| Window length | `LOGIN_THROTTLE_WINDOW_MS` | 60 000 |
| Retry-After hint | `LOGIN_THROTTLE_RETRY_AFTER_SECONDS` | 60 |

- 429 responses carry `Retry-After` header AND a `RATE_LIMITED` envelope.
- Window length and retry-after are separate knobs (never coupled).
- Bounded memory: fixed-cap LRU map (5 000 keys) + periodic prune.
- Only FAILED attempts count; successes never consume capacity.

## 6. Algorithm workbench (PRD §6)

`algorithms.ts` — five-entry hard-coded catalog (fizzbuzz, reverse,
word-count, dedupe, caesar). Input is always data; there is NO code-execution
path. Input bounded at 10 000 chars (413 `INPUT_TOO_LARGE`); malformed input
422. Each result reports measured wall-clock `durationMs` (monotonic
`hrtime.bigint()`) separately from the theoretical `complexity` string.

## 7. Data model + security rules

Firestore layout (server accesses via Admin SDK; rules bind clients):

```
users/{uid}                       profile (email, displayName, createdAt)
users/byEmail/keys/{normalized}   unique-email key (uid) — atomic create()
users/{uid}/documents/{docId}     owner-scoped documents
sessions/{sha256(token)}          server-only session digests
```

`firestore.rules` (tested against the REAL emulator with
`@firebase/rules-unit-testing`): clients can read/write only their own
`users/{uid}/documents/**`; sessions, unique-email keys and other users'
data are unreachable; server writes use the Admin SDK (bypasses rules).

## 8. Prefixes (rule 7)

- API: everything under **`/api/v1`** (Cloud Functions path
  `/<project>/<region>/api/v1/**`).
- Web: Angular app served from its own origin/hosting target; in dev the
  Angular dev server proxies `/api/v1` to the Functions emulator
  (`web/proxy.conf.json`). The web app never serves API routes itself.

## 9. SSE (rule 6)

Forbidden and absent: no `text/event-stream` endpoint exists; tests assert
`/api/v1/events` and `/api/v1/stream` 404 into the JSON envelope.

## 10. Testing topology

- **Functions:** vitest + supertest drive the production Express app with
  `firebase-admin` pointed at the REAL Auth (9099) + Firestore (8088)
  emulators, booted by `firebase emulators:exec` (`npm run test:emulator`).
  Rules are tested with `@firebase/rules-unit-testing` client contexts.
- **Web:** vitest + jsdom + `@analogjs/vitest-angular` (zone.js setup),
  stubbed `fetch` — no emulator dependency.
- **Production deploy, Android runtime:** UNVERIFIED (see verification.md).
