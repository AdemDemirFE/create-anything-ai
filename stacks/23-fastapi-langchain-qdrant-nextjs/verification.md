# Verification — Stack 23 (Wave 4)

**Verified at (local):** 2026-10-25, 00:20–00:55 UTC+3 (initial runs) and
re-runs through ~02:00 UTC+3
**Branch:** `feat/stack-23-fastapi-langchain-qdrant-nextjs`
**Scope rule:** every claim below is tied to a command that actually ran in
this session. Anything not run is marked **UNVERIFIED** with the reason.

## 1. Environment

| Tool | Version | Source |
|---|---|---|
| Python | 3.13.2 | `python --version` |
| Node.js | v24.19.0 | `node --version` |
| npm | 11.17.0 | `npm.cmd --version` |
| Docker | NOT exercised (no Qdrant server needed for the tested paths) | see gaps |
| Qdrant server | NOT RUNNING / not available | see unverified list |

All backend dependency versions are **pinned** in
`backend/requirements.txt` (fastapi 0.129.0, uvicorn 0.41.0,
pydantic[email] 2.12.5, bcrypt 4.3.0, langchain-core 1.7.0,
langchain-text-splitters 1.1.3, qdrant-client 1.20.0, python-multipart
0.0.32, pytest 9.1.1, httpx 0.28.1, anyio 4.15.1). Availability of every
pin was checked against PyPI (`pip index versions …`) before pinning, and
the venv install below is the proof they resolve. Web deps are
lockfile-pinned (`web/package-lock.json`).

## 2. Backend — `python -m pytest` (REAL, PASSED)

Commands (exact):

```powershell
cd stacks/23-fastapi-langchain-qdrant-nextjs/backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m pytest
```

Result: **74 passed, 0 failed, 2 warnings (starlette/anyio deprecations
inside the TestClient library itself), EXIT 0** — in ~56 s.

```text
74 passed, 2 warnings in 56.16s
```

What the suites cover:

- `test_rag_pipeline.py` (17) — **the ingest/retrieval pipeline really
  runs**: `DeterministicFakeEmbedding` is the real LangChain class and is
  asserted deterministic (same text -> same vector), different text ->
  different vector, correct dimension; `RecursiveCharacterTextSplitter`
  chunking is bounded and empty-safe; `LocalVectorStore` roundtrip,
  per-user isolation, and clear; `QdrantVectorStore` with the **real
  qdrant-client in `:memory:` mode** (not a mock): upsert/search roundtrip,
  multi-chunk documents with no id collisions (8/8 chunks retrieved after
  the SHA-256 point-id fix), per-user isolation; full
  ingest->retrieve->generate pipeline; the generator's honest refusal on
  empty retrieval, source citations, and grounded fallback. Retrieval
  ranking beyond determinism is explicitly NOT claimed (hash-based fake
  embeddings have no semantics) — the generator's keyword scoring is what
  surfaces the relevant sentence, and that is what is asserted.
- `test_api_integration.py` (22) — register 201 / invalid email 422 /
  weak password 422 / duplicate 409 without leakage; login success +
  cookie flags (`STACK23_SESSION`, `HttpOnly`, `SameSite=lax` asserted on
  the wire); generic invalid credentials; unknown-email vs wrong-password
  indistinguishability; **throttle: 5×401 then 429 + `Retry-After`, 429
  even with the correct password, success clears the tally**; all five
  protected endpoints 401 unauthenticated; home payload when authed;
  logout invalidates server-side; forged cookie never authenticates.
- `test_envelope.py` (10) — §7 envelope contract: exact top-level keys,
  meta timestamp/request_id, error shape with stable codes, `data: null`
  preserved, `execution_ms` present only where measured (chat) and equal
  to `data.executionMs`, X-Request-Id correlation incl. injection-value
  replacement.
- `test_documents_api.py` (10) — `.txt`/`.md` accepted; `.exe` rejected
  `UNSUPPORTED_FILE_TYPE`; >2 MiB rejected `FILE_TOO_LARGE`; empty text
  rejected `EMPTY_DOCUMENT`; 50-document cap enforced
  `DOCUMENT_LIMIT_REACHED`; empty filename field 422; list endpoint empty
  and populated; per-user document isolation.
- `test_chat_api.py` (7) — grounded answer with sources end-to-end
  (upload -> ask -> cited extractive answer); envelope contract on chat;
  **chat is JSON, not a stream** (content-type asserted, single parseable
  envelope); `NO_DOCUMENTS` 400 before any upload; empty question 422;
  oversized question rejected; extra fields rejected; 401 unauthenticated;
  **cross-user isolation: user B's chat never surfaces user A's document
  content or filenames**.
- `test_security_store.py` (8) — bcrypt roundtrip, wrong-password failure,
  salted uniqueness, long-password pre-hash (no silent 72-byte truncation),
  malformed hash clean failure, 256-bit CSPRNG tokens, digest-only
  storage, session expiry (fake clock), throttle window/clear.

Issues found and fixed during real runs (all resolved, suite green):

1. Qdrant point ids derived from a plain slice of the document uuid would
   collide between chunks of the same document (later chunks silently
   overwrote earlier ones; the 8-chunk test surfaced it). Fixed with a
   SHA-256-prefix numeric id; the multi-chunk test now pins 8/8 retrieval.
2. Route code briefly mutated `STORE`-created documents post-hoc to align
   ids; refactored so `STORE.add_document` receives the pipeline's
   document id directly (single source of truth).
3. A first relevance test assumed semantic ranking from the hash-based
   fake embedding and failed (`a.md` vs `b.md`); rewritten to assert what
   the deterministic provider actually guarantees (deterministic order,
   user-owned sources only, generator keyword selection) instead of a
   semantic claim the embedding cannot make.

## 3. Backend with the Qdrant backend selected (REAL, PASSED)

Additional end-to-end smoke with the adapter factory switched (exact):

```powershell
$env:STACK23_VECTOR_STORE='qdrant'
$env:STACK23_QDRANT_IN_MEMORY='1'
.\.venv\Scripts\python.exe -c "…register→login→upload→documents→chat…"
```

Result: documents list correct, chat answered with the cited sentence from
the uploaded document through the real qdrant-client code path. This
proves the adapter wiring, not a live server (see §7).

## 4. Web — `npm test` + `npm run build` (REAL, PASSED)

Commands (exact):

```powershell
cd stacks/23-fastapi-langchain-qdrant-nextjs/web
npm.cmd install          # exit 0 (audit warnings only, no blockers)
npm.cmd test             # vitest run
npm.cmd run build        # next build (includes type checking)
```

Results:

```text
npm.cmd test        → Test Files 2 passed (2), Tests 15 passed (15), EXIT 0
npm.cmd run build   → ▲ Next.js 14.2.35, ✓ Compiled successfully,
                      ✓ Linting and checking validity of types,
                      ✓ Generating static pages (9/9), EXIT 0
Routes: / (redirect) /chat /documents /home /login /register (+ /_not-found)
```

Coverage: API client envelope handling (success/error/429/network
synthesis/multipart upload/JSON-only chat POST), Register + Login forms
(labels, submit, throttle-429 alert), Home (profile email + metrics +
logout button, 401 redirect), Documents (list with chunk counts, empty
state), Chat (thinking state -> answer with sources and measured ms,
`NO_DOCUMENTS` alert). The chat tests exercise the polling POST model —
no EventSource or stream reader exists anywhere in the client (also
asserted by the client test that pins `method: 'POST'` + JSON body).

Issues found and fixed during real runs (all resolved, suite green):

1. A page test used the wrong relative import path after the app-router
   layout (`../app/...` -> `./app/...`).
2. The chat screen called `element.scrollTo` unconditionally; jsdom does
   not implement it. The component now guards on feature detection
   (browsers unchanged, tests stable).
3. Transport-level `fetch` rejections were not converted to the
   `NETWORK_ERROR` envelope error (only non-JSON bodies were); the client
   now wraps both paths.
4. Auth-gated page tests raced the async `useRequireAuth` resolution;
   switched to `findByLabelText` waits.

## 5. Runtime smoke (REAL, PASSED)

A TestClient end-to-end pass over the live app object ran during
development (health 200 → register 201 → login 200 + Set-Cookie → upload
201 with chunkCount → documents 200 → chat 200 with grounded cited answer
and `executionMs`), plus the §3 Qdrant-backend variant. The same paths are
covered by the committed integration suite, which is the durable evidence.

## 6. Security review notes

- No secrets committed: `.env.example` carries placeholders and comments
  only; `OPENAI_API_KEY` is documented as env-only and is never read from
  any file; the default mode requires no key at all. Test literals are
  plain dictionary-type values (no leetspeak "real-password lookalikes",
  per the GG lesson from earlier waves).
- Envelope error responses never include stack traces or internals
  (test-asserted); unexpected exceptions are caught and returned as
  generic `INTERNAL_ERROR`.
- Passwords: bcrypt 12 rounds, salted, pre-hashed when >72 bytes, hashed
  and verified inside a bounded `ThreadPoolExecutor` (never on the event
  loop); never returned or logged.
- Session fixation: a fresh token is minted on every login; logout
  invalidates server-side and the cookie is cleared (test-asserted).
- Throttle: 5 failed / 60 s per email+IP -> 429 + Retry-After; XFF ignored
  (untrusted peer control); success clears the tally (all test-asserted).
- Enumeration defense: unknown email vs wrong password identical responses
  (test-asserted).
- Uploads: suffix allowlist (`.txt`/`.md`), 2 MiB cap, 50 docs/user, empty
  rejection, bounded decode — all test-asserted. Chat questions bounded at
  4,000 chars (schema + route).
- RAG isolation: vector operations are namespaced per authenticated user
  id in both adapters; cross-user chat isolation is integration-asserted.
- Chat: JSON-only; no `StreamingResponse`/SSE endpoint exists (QA M9
  lesson; asserted by test).

## 7. Known gaps / unverified areas

| Area | Status | Reason |
|---|---|---|
| Live Qdrant server (`STACK23_QDRANT_IN_MEMORY=0` + `STACK23_QDRANT_URL`) | **UNVERIFIED** | no Qdrant server was available in this environment; the in-memory client mode is the tested path. First action when a server exists: set the two env vars and re-run the smoke + suite |
| OpenAI embedding mode (`langchain-openai`) | **UNVERIFIED** | optional dependency not installed (keeps default offline); requires a real `OPENAI_API_KEY` which must never enter this repo. Failure paths (missing pkg/key) are unit-asserted via the factory contract |
| Docker / docker-compose | not exercised | no daemon assumed in this session; compose file ships as declared-but-unrun |
| Browser e2e (Playwright) | not implemented | out of scope for this task |
| Automated a11y audit | not implemented | out of scope (labels/roles hand-checked) |
| Backend hot-reload run (`uvicorn --reload`) | not run as a separate step | TestClient + integration suite cover the app; the documented startup command follows the same factory |
| Generative LLM answer step | intentionally absent | extractive generator is the shipped, testable scope; documented follow-up |

## 8. stack.json verification flags

- `manifest`: **true** — structure checked against
  `schemas/stack-manifest.schema.json` (id pattern, category policy,
  maturity enum, versions as version-strings, verification block); CI
  validate-catalog re-checks on the PR.
- `unit`: **true** — pytest unit files (rag pipeline / security-store /
  envelope) really ran green; web vitest suite really ran green.
- `integration`: **true** — `test_api_integration.py`, documents/chat API
  suites, and the full RAG pipeline over the real qdrant-client
  `:memory:` path really ran green (74 total backend).
- `e2e`: **false** — no automated browser e2e was run.
- `lastVerifiedAt`: 2026-10-24T21:55:00Z (UTC timestamp of the green
  backend runs; web re-runs followed within the same session).
- `evidencePath`: `verification.md` (this file).
