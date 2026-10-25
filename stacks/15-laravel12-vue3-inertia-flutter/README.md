# Stack 15 — Laravel 12 + Inertia 2 + Vue 3 + Flutter

Reference implementation of the four-screen journey (register, login,
dashboard/notes, algorithm workbench) on Laravel 12 with Inertia 2 +
Vue 3 pages and a Flutter mobile client.

> **Status: scaffolded.** Web + API are implemented and tested (PHPUnit
> feature suite, vitest, real-HTTP smoke script). The Flutter client is
> written against the frozen API contract but has never been compiled or
> run (no Flutter SDK in the implementation environment). Details and
> evidence: `verification.md`.

## Layout

```
laravel/            Laravel 12 app (web + /api/v1 JSON)
  routes/web.php    Inertia pages (web group: sessions + CSRF)
  routes/api.php    /api/v1 JSON API (session-cookie auth, NO CSRF, throttle:api)
  app/Http/Responses/Envelope.php   { ok, data, error, requestId } builder
  scripts/smoke.mjs real-HTTP contract walk (53 checks)
  resources/js/     Vue 3 pages + shared envelope helper (vitest-covered)
mobile/             Flutter client — NOT VERIFIED (no SDK), see its README
ARCHITECTURE.md     envelope, auth, CSRF trade-off, throttle decisions
verification.md     what ran, what did not, exact commands
stack.json          catalog manifest with verification flags
```

## Prerequisites

- PHP >= 8.2 with `pdo_sqlite` (and `pdo_pgsql` for production PostgreSQL)
- Composer 2.x
- Node.js >= 20 (24 used for verification)

## Quick start (web + API)

```powershell
cd laravel
composer install
cp .env.example .env          # then: php artisan key:generate
php artisan migrate           # sqlite by default
npm ci
npm run build                 # or: npm run dev for HMR during development
php artisan serve             # http://127.0.0.1:8000
```

- Inertia app: open http://127.0.0.1:8000 (Welcome → Register/Login →
  Dashboard → Notes → Algorithm workbench).
- JSON API: http://127.0.0.1:8000/api/v1/health (envelope:
  `{ ok, data, error, requestId }` — see `ARCHITECTURE.md`).

## Tests

```powershell
cd laravel
php vendor\phpunit\phpunit\phpunit     # 49 tests, 245 assertions
npm test                               # vitest: envelope + page tests
node scripts\smoke.mjs                 # with the server running on :8000
```

`smoke.mjs` targets `http://127.0.0.1:8000` by default; override with
`SMOKE_BASE_URL`. It requires a fresh database (`php artisan migrate:fresh
--force` recommended — it registers throwaway users).

## Flutter client (unverified)

```bash
cd mobile
flutter pub get
flutter analyze
flutter test
```

These commands have NOT been executed against this code (no SDK available
during implementation); treat `mobile/` as a contract-conformant screen map
until they pass. Session cookie storage uses `flutter_secure_storage`.
