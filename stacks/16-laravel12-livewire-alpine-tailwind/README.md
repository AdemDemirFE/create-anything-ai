# Stack 16 — Laravel 12 + Livewire 3 + Alpine 3 + Tailwind CSS 3 (TALL)

Reference implementation of the four-screen journey (register, login,
dashboard/notes, algorithm workbench) on Laravel 12 with a TALL
front-end: Livewire 3 full-page components, Alpine 3 for micro-UI,
Tailwind CSS 3 for styling — and zero app-authored client-side
JavaScript.

> **Status: scaffolded.** Implemented and tested: PHPUnit feature suite
> (63 tests, 290 assertions, incl. `Livewire::test()` component tests)
> and a 67-check real-HTTP smoke script. Details and evidence:
> `verification.md`.

## Layout

```
laravel/                        Laravel 12 app (web + /api/v1 JSON)
  routes/web.php                Blade pages + full-page Livewire components
                                (web group: sessions + CSRF; includes
                                Livewire's /livewire/update)
  routes/api.php                /api/v1 JSON API (session-cookie auth,
                                NO CSRF, throttle:api)
  app/Livewire/                 Notes\{Index,Show,Form} + Workbench
                                (full-page components, #[Locked] ids)
  app/Http/Responses/Envelope.php   { ok, data, error, requestId } builder
  scripts/smoke.mjs             real-HTTP contract walk (67 checks)
  resources/views/components/app-layout.blade.php   <x-app-layout>
  resources/js/app.js           Alpine bootstrap (no app code)
ARCHITECTURE.md                 envelope, auth, CSRF trade-off, Livewire
                                hardening, Inertia-vs-Livewire contrast
verification.md                 what ran, what did not, exact commands
stack.json                      catalog manifest with verification flags
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

- TALL app: open http://127.0.0.1:8000 (Welcome → Register/Login →
  Dashboard → Notes → Algorithm workbench; notes and workbench are
  full-page Livewire components).
- JSON API: http://127.0.0.1:8000/api/v1/health (envelope:
  `{ ok, data, error, requestId }` — see `ARCHITECTURE.md`).

## Tests

```powershell
cd laravel
php vendor\phpunit\phpunit\phpunit     # 63 tests, 290 assertions
node scripts\smoke.mjs                 # with the server running on :8000
```

`smoke.mjs` targets `http://127.0.0.1:8000` by default; override with
`SMOKE_BASE_URL`. It requires a fresh database (`php artisan migrate:fresh
--force` recommended — it registers throwaway users) and, for the 419-leak
check to be meaningful, a server whose `APP_DEBUG=false`.

## Sibling stack

`../15-laravel12-vue3-inertia-flutter` implements the identical backend
contract with Inertia 2 + Vue 3; `ARCHITECTURE.md` §7 contrasts the two
approaches (envelope normalization on the client vs no client data layer
at all).
