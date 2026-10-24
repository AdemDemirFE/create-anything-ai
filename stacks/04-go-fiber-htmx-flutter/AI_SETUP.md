# AI Agent Setup — Stack 04

Instructions for AI agents working in `stacks/04-go-fiber-htmx-flutter/`.

## Ground truth before writing code

1. Read `stacks/04-go-fiber-htmx-flutter/ARCHITECTURE.md` — the API boundary,
   auth decision (server-side sessions), in-memory store decision, XFF
   policy, and verification status are documented there and are binding.
2. Read `docs/PRODUCT_REQUIREMENTS.md` section 6 (four-screen contract) and
   section 7 (API envelope). Every JSON response MUST use that envelope.
3. Read `docs/QUALITY_GATES.md`. Never claim a gate you did not observe.

## Environment facts (as of 2026-10-24)

- Go 1.27.0 available (`go version` → go1.27.0 windows/amd64).
- Node.js is NOT needed by this stack (no SPA, no build step).
- **Flutter SDK NOT available** — mobile code is written to the documented
  contract but CANNOT be run, analyzed, or tested. Never write "tested" for
  anything Flutter.
- Docker: CLI present; the compose stack has NOT been built/run. Compose is
  declarative and unverified.

## API contract (frozen for this stack)

Base path `/api/v1`, repository envelope on every response:

```json
{
  "success": true,
  "data": {},
  "error": null,
  "meta": { "timestamp": "...", "execution_ms": 2.4, "request_id": "opaque" }
}
```

Endpoints: `POST /register`, `POST /login`, `POST /logout`, `GET /me`,
`GET /home`, `GET /algorithm`, `POST /algorithm/run`, `GET /healthz`.
Session cookie: `STACK04_SESSION` (HttpOnly, SameSite=Lax, Secure when
`COOKIE_SECURE=true`). Error codes are the stable strings listed in
ARCHITECTURE.md §3. Changing the contract requires updating backend, web
templates, mobile, and the tests together.

## Rules for agents

- Backend changes must keep `go test ./...` green (31 tests). Run it; report
  the real result. `go vet ./...` must stay clean.
- Web screens are SERVER-RENDERED (`html/template` + htmx enhancement). Do
  not introduce a SPA, a Node build, or client-side state management.
- Mobile changes: update `frontend-mobile/lib/` + `pubspec.yaml` only;
  record in `verification.md` that they remain unverified.
- Never execute user-supplied code in the algorithm workbench. Only the
  fixed catalog in `internal/algorithm` is runnable. Input is capped at
  `algorithm.MaxInputLength` (10,000 chars).
- Never commit secrets. This stack needs none; `.env.example` carries
  placeholders only.
- Do not add dependencies without version pinning (`go get pkg@version`)
  and a reason recorded in go.mod-adjacent docs; keep the tree minimal.

## Verification workflow

1. Make the change in one layer (or contract-coherent layers).
2. `cd backend && go test ./...` (Windows: same command).
3. Update `verification.md` with exact commands + outcomes; update
   `stack.json` verification flags only for layers you actually ran.
4. Report changed files, commands, and known gaps — never invented results.
