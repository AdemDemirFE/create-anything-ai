# Stack 17 — Laravel 12 backend (web + /api/v1)

Laravel 12 + Inertia 2 + **React 19 (TypeScript)** reference backend for
catalog entry `17-laravel12-react-inertia-reactnative`.

- `routes/web.php` — the four Inertia screens (welcome, register/login,
  dashboard + notes, note detail/form + algorithm workbench). React page
  components live in `resources/js/pages/`.
- `routes/api.php` — the `/api/v1` JSON surface (envelope
  `{ ok, data, error, requestId }`, session-cookie auth, no CSRF — see
  `../ARCHITECTURE.md`).
- The shared TypeScript client lives in `../shared/` and is consumed by the
  JSON surface consumers (RN thin shell, tests); the Inertia pages speak
  Laravel's native redirected error-bag dialect via `useForm`.

## Run locally

```bash
composer install
cp .env.example .env
php artisan key:generate
php artisan migrate            # sqlite by default
npm ci && npm run build        # builds resources/js/app.tsx via Vite
php artisan serve              # http://127.0.0.1:8000
```

## Test

```bash
php vendor/bin/phpunit         # feature suite (envelope/auth/throttle/CRUD/wiring)
npm test                       # vitest (React page tests)
node scripts/smoke.mjs         # real-HTTP contract walk (server must be running)
```
