# Stack 23 Architecture — FastAPI + LangChain + Qdrant + Next.js

## 1. Identity and maturity

- **ID:** `23-fastapi-langchain-qdrant-nextjs`
- **Name:** FastAPI / LangChain / Qdrant / Next.js
- **Category:** `ai-native`
- **Maturity:** `scaffolded` (see verification.md for gate-by-gate evidence)
- **Owner:** Stack 23 reference implementation session (Wave 4)
- **Last verified (UTC):** 2026-10-24
- **Supported OS (tested):** Windows 11 (backend + web)
- **License notes:** FastAPI/MIT, LangChain/MIT, qdrant-client/Apache-2.0,
  Next.js/MIT, React/MIT, bcrypt/Apache-2.0 (Python binding), uvicorn/BSD-3.
  No license conflicts.

## 2. Technology and compatibility matrix

| Component | Target version | Tested version | Support evidence |
|---|---|---|---|
| Language (backend) | Python 3.13+ | 3.13.2 | `python --version`, real pytest run |
| Backend framework | FastAPI 0.129 | 0.129.0 | pinned in requirements.txt, real tests |
| ASGI server | uvicorn 0.41 | 0.41.0 | pinned; run command documented |
| Embeddings interface | langchain-core 1.7 | 1.7.0 | real imports + pipeline tests |
| Text splitting | langchain-text-splitters 1.1 | 1.1.3 | real ingest tests |
| Vector store (alt) | qdrant-client 1.20 | 1.20.0 | real `:memory:` client tests |
| Password hashing | bcrypt 4.3 (direct, off-loop) | 4.3.0 | real register/login/throttle tests |
| Web framework | Next.js 14 (App Router) | 14.2.35 | real `next build` (exit 0) |
| UI library | React 18 | 18.3.1 | real vitest + build |
| Test runners | pytest 9.1 / vitest 4 | 9.1.1 / 4.0.4 | real runs (74 + 15 tests) |

**Optional dependency — `langchain-openai`:** intentionally NOT in
requirements.txt. The OpenAI embedding path lazy-imports it and fails fast
with a clear message when the package or `OPENAI_API_KEY` is missing, so the
default offline path installs nothing it does not use and no key material is
ever required or committed.

## 3. Architecture

### Process boundaries

- One backend process (uvicorn, :8000). The Next.js app is a separate
  process (:3000 dev / `next start`); `next.config.mjs` rewrites `/api/*`
  to the backend so the session cookie is always first-party.
- Clients never touch vector storage; the REST API is the only trust
  boundary, and every vector operation is namespaced per user id.

### Module layout

```text
backend/app/
├── main.py                # app factory, middleware, handler wiring
├── config.py              # env-overridable settings (no secrets)
├── store.py               # thread-safe in-memory users/sessions/docs/throttle
├── security.py            # bcrypt off-loop + CSPRNG session tokens
├── api/
│   ├── routes.py          # /api/v1 endpoints + 401/422 envelope handlers
│   └── schemas.py         # request/response DTOs (aliases for camelCase)
├── auth/
│   ├── sessions.py        # cookie lifecycle (HttpOnly, SameSite=Lax)
│   └── throttle.py        # failed-login rate limiting -> 429
├── rag/
│   ├── embeddings.py      # Embeddings factory (fake | openai)
│   ├── vector_store.py    # VectorStoreAdapter (local | qdrant)
│   ├── ingest.py          # chunk -> embed -> upsert
│   ├── pipeline.py        # retrieve + answer orchestration (singletons)
│   └── generator.py       # extractive, cited answers (no LLM required)
└── web/
    ├── envelope.py        # §7 envelope builders + monotonic measurement
    └── error_codes.py     # stable error code strings
```

### RAG backends — the adapter decision (task requirement)

The pipeline depends on two narrow interfaces, never on concrete backends:

- `langchain_core.embeddings.Embeddings` — `build_embeddings()` returns
  LangChain's **real** `DeterministicFakeEmbedding` by default (a seeded
  hashing embedder; same text -> same vector, offline). `openai` mode
  lazy-imports `langchain-openai.OpenAIEmbeddings` and requires
  `OPENAI_API_KEY` from the environment.
- `VectorStoreAdapter` (this codebase) — `LocalVectorStore` (default:
  JSON-file-backed brute-force cosine, one file per user under
  `STACK23_LOCAL_STORAGE_DIR`) or `QdrantVectorStore` (real `qdrant-client`;
  `:memory:` mode is what the automated tests exercise — the same client
  code path as a live server, **not** a mock; live-server mode reads
  `STACK23_QDRANT_URL`).

This is the "test çift-yollu" architecture requested for the task: the full
stack runs and is tested with zero external services, while flipping two
env vars swaps in production-grade backends without touching pipeline code.

**Generation decision:** `generator.py` is extractive (keyword-scored
sentences from retrieved chunks, with `[source: ...]` citations). It never
calls an LLM, so chat answers are deterministic and testable. A generative
LLM step is a documented follow-up, not a hidden network call: when the
OpenAI embedding provider is configured, retrieval upgrades automatically,
but answer generation stays extractive in this reference scope.

### Ingest flow

`POST /api/v1/documents` (multipart): validate filename/suffix (`.txt`,
`.md`) -> enforce 2 MiB byte limit -> decode UTF-8 (replacement for stray
bytes) -> 400k char text bound -> split with
`RecursiveCharacterTextSplitter` (800/100, deterministic separators) ->
embed chunks -> upsert through the adapter -> record metadata in the store.
Users are capped at 50 documents; empty documents are rejected with
`EMPTY_DOCUMENT`.

### API boundary and DTOs

All endpoints wrap every response in the repository envelope
(docs/PRODUCT_REQUIREMENTS.md §7): `success` / `data` / `error` / `meta`
with `timestamp` and `request_id`; `execution_ms` only where measured
(chat turns, both `meta.execution_ms` and `data.executionMs`). Response
DTOs serialize with camelCase aliases (`documentId`, `chunkCount`,
`executionMs`, `serverTime`). Correlation id also flows back via
`X-Request-Id` (validated `^[A-Za-z0-9-]{1,64}$`, replaced otherwise —
Stack-20 lesson).

Stable error codes: `VALIDATION_ERROR`, `EMAIL_TAKEN`, `INVALID_CREDENTIALS`,
`RATE_LIMITED`, `UNAUTHORIZED`, `INTERNAL_ERROR`, `FILE_REQUIRED`,
`UNSUPPORTED_FILE_TYPE`, `FILE_TOO_LARGE`, `DOCUMENT_LIMIT_REACHED`,
`EMPTY_DOCUMENT`, `QUERY_TOO_LARGE`, `NO_DOCUMENTS`. FastAPI's 422 responses
are re-wrapped into `VALIDATION_ERROR` envelopes with field details;
authentication failures become `UNAUTHORIZED` envelopes (401), never bare
`detail` objects.

### Persistence

- **In-memory store** (`store.py`): users, sessions, document metadata, and
  throttle tallies guarded by an `RLock`. Lost on restart; documented.
- **Local vector storage**: `user-<id>.json` files (atomic tmp+replace
  writes) under `.local_storage/` — git-ignored runtime data, not source.
- A database swap-in would keep the `MemoryStore` method surface — noted
  as a natural follow-up, not claimed as present.

### Auth/session model (carried over from stacks 01/20)

- **Server-side sessions, not JWT**: logout must invalidate immediately and
  server-side; no cross-service token exchange at this scope.
- **Cookie:** `STACK23_SESSION`, HttpOnly, SameSite=Lax, path `/`,
  Max-Age 1800 s; server-side expiry is a **sliding idle window** refreshed
  on every authenticated request. `Secure` flag behind TLS via
  `SECURE_COOKIES=1` (documented, off in dev by design).
- **Tokens:** 32 bytes from the OS CSPRNG (`secrets.token_hex`), stored only
  as a SHA-256 digest; the raw token lives only in the cookie and is never
  logged. Forged/unknown cookies fail resolution -> 401.
- **Passwords:** bcrypt 12 rounds with per-hash salts, hashed inside a
  bounded `ThreadPoolExecutor` (`hash_password_async` /
  `verify_password_async`) so the event loop never blocks on the ~100-300 ms
  CPU-bound hash (Stack-20 review lesson, explicitly required by the task).
  Long inputs are SHA-256 pre-hashed to avoid bcrypt's silent 72-byte
  truncation. Unknown-email logins burn one verification against a fixed
  non-secret throwaway hash to equalize response timing.
- **Login throttle:** 5 failed attempts per pinned 60 s window, keyed on
  email + direct connection peer. X-Forwarded-For is deliberately ignored
  (untrusted without a trusted-proxy config). Exceeding the limit returns
  **HTTP 429 + `Retry-After: 60`** and stays 429 even with correct
  credentials until the window expires; success never counts and clears the
  tally. Demo-grade, documented as such; production should enforce limits at
  the edge.
- **Enumeration defense:** unknown email and wrong password return identical
  code + message + status (test-asserted).
- **CSRF strategy:** SameSite=Lax cookies + strict CORS allowlist
  (credentials enabled) + JSON/multipart-only state-changing calls, same
  rationale as stacks 01/20.
- **CORS:** explicit allowlist from `ALLOWED_ORIGINS`
  (default `localhost:3000` + `127.0.0.1:3000`), credentials enabled,
  methods GET/POST/OPTIONS only.

### Chat contract — no streaming (QA lesson M9)

`POST /api/v1/chat` returns a single JSON envelope. There is deliberately
**no** `StreamingResponse`, no SSE, no chunked transfer: streaming responses
proved error-prone in earlier waves (QA M9), so the client polls by issuing
a plain POST per question. The UI shows a local "Thinking…" row while the
request is in flight — that is UI state, not a stream consumer. Measured
pipeline duration is reported honestly as `executionMs` (monotonic clock),
separate from any quality claim.

## 4. Four-screen mapping

| Requirement | Implementation path/screen | Server-side protection | Tests |
|---|---|---|---|
| Register | web `src/app/register` | validation, bcrypt, unique email, 409 duplicate | `TestRegister` (4) + AuthForm tests |
| Login | web `src/app/login` | throttle -> 429 + Retry-After, generic failure, session cookie | `TestLogin` (7) + AuthForm tests |
| Home | web `src/app/home` | backend session required; 401 otherwise; profile + metrics | `TestProtected` (6) + HomePage tests |
| Workbench (RAG chat + documents) | web `src/app/documents`, `src/app/chat` | session required; bounded uploads/questions; per-user isolation | `TestDocumentsUpload` (7), `TestChat*` (8) + page tests |
| Logout/revocation | web Home button | server-side session invalidation | `TestLogoutAndRevocation` (2) |

The "algorithm workbench" of the universal contract is instantiated here as
the **RAG workbench**: bounded input (2 MiB files / 4,000-char questions),
no arbitrary code execution (fixed extractive pipeline only), measured
duration shown separately from any complexity statement, and per-request
citations.

## 5. Environment variables

| Name | Purpose | Required | Default | Secret |
|---|---|---|---|---|
| `STACK23_EMBEDDING_PROVIDER` | embedding backend: `fake` or `openai` | no | `fake` | no |
| `OPENAI_API_KEY` | key for `openai` embedding mode (read from env, never committed) | only for openai mode | — | **yes** |
| `STACK23_VECTOR_STORE` | `local` or `qdrant` | no | `local` | no |
| `STACK23_QDRANT_IN_MEMORY` | `1` = qdrant-client `:memory:` mode | no | `1` | no |
| `STACK23_QDRANT_URL` | live Qdrant server URL (when not in-memory) | only for live qdrant | — | no |
| `STACK23_QDRANT_COLLECTION` | collection prefix | no | `stack23_chunks` | no |
| `STACK23_LOCAL_STORAGE_DIR` | local retriever data directory | no | `.local_storage` | no |
| `SECURE_COOKIES` | enable Secure cookie flag (TLS deployments) | no | empty | no |
| `ALLOWED_ORIGINS` | CORS allowlist override | no | localhost:3000 set | no |
| `STACK23_API_URL` | web -> backend rewrite target | no | `http://localhost:8000` | no |

`.env.example` documents all of them with placeholders only; no real key
exists anywhere in the repository.

## 6. Local setup

See README.md (exact tested commands). Startup: backend on :8000, then
`npm run dev` (or `npm run build && npm start`) on :3000.

## 7. Security

- Input validation: Pydantic schemas with `extra="forbid"`, explicit length
  bounds; validation errors re-wrapped as envelope `VALIDATION_ERROR`.
- AuthN: bcrypt (off-loop) + HttpOnly/SameSite=Lax session cookies; raw
  tokens never stored server-side.
- AuthZ: every non-public endpoint requires a valid session (dependency);
  401 envelopes otherwise (test-asserted per endpoint). Vector operations
  are keyed by the authenticated user id only (isolation test-asserted for
  both adapters).
- Uploads: suffix allowlist, 2 MiB cap, per-user count cap, text-length cap,
  empty-document rejection — all test-asserted.
- CORS: allowlist + credentials; unknown origins rejected by Starlette
  (allowlist behavior pinned by the shared middleware contract).
- Rate limits: login throttle 5/min per email+IP (demo-grade, documented).
- Secrets: none committed; none required at runtime in the default mode.
- Logging: passwords/tokens/cookies never logged; unexpected errors return
  a generic `INTERNAL_ERROR` envelope while the traceback stays server-side.
- Dependency scanning: repository CI Gitleaks covers the diff; per-stack
  Dependabot config is out of scope for this task.

## 8. Testing and acceptance

- Unit: `test_security_store.py` (8), `test_rag_pipeline.py` (17, incl. the
  real qdrant-client `:memory:` path) — real runs.
- Envelope contract: `test_envelope.py` (10) — §7 shape, X-Request-Id
  validation, `execution_ms` only where measured.
- Integration (TestClient): `test_api_integration.py` (22) — journeys,
  cookie flags, throttle 429 + Retry-After, enumeration defense, 401 paths.
- Documents/chat APIs: `test_documents_api.py` (10), `test_chat_api.py` (7)
  — limits, error codes, grounded answers, per-user isolation, JSON-only
  chat (explicitly asserted non-streaming).
- Web: `client.test.ts` (6), `pages.test.tsx` (9) — real vitest run;
  `npm run build` (Next.js production build incl. type checking) exit 0.
- UI/e2e: not automated in this task (documented gap).
- Accessibility: labeled inputs, `role="alert"`, `role="status"`,
  `aria-busy`/`aria-live` used; no automated a11y audit — documented gap.

## 9. Operational readiness

- Health: `GET /api/v1/health` (public, trivial JSON, envelope-less).
- Logs: default uvicorn console logs; no request bodies logged anywhere.
- Graceful shutdown: uvicorn SIGINT/SIGTERM default behavior.
- Backup/restore: not applicable to in-memory/local-file reference data
  (documented); local vector files can be re-ingested from sources.
- Metrics: none yet; observability is an explicit follow-up.

## 10. Agent task plan (this session)

| Task | Scope | Status |
|---|---|---|
| 23a | FastAPI backend: auth/throttle/envelope + RAG pipeline + tests | done (74/74 real) |
| 23b | Next.js 14 web: four screens + chat UI + tests + build | done (15/15 + build exit 0) |
| 23c | stack.json / README / ARCHITECTURE / verification.md / .env.example | done (evidence-based) |
| 23d | Live Qdrant server / docker compose run / e2e | out of scope for this session (unverified, listed) |
