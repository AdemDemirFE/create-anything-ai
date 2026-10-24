# Stack 15 — Flutter mobile client (NOT VERIFIED)

This directory contains the Flutter screen map for the four-screen journey.
**It has never been compiled, analyzed, or tested**: the Flutter SDK is not
available in the implementation environment (see `../verification.md`).

Do NOT claim this code runs. First actions once an SDK exists:

```bash
flutter pub get
flutter analyze
flutter test
```

## Screen map

| Journey | Screen | File | Contract |
|---|---|---|---|
| A — Register | `RegisterScreen` | `lib/screens/register_screen.dart` | `POST /api/v1/register`; VALIDATION_ERROR details under fields, duplicate email presented like any invalid field |
| B — Login | `LoginScreen` | `lib/screens/login_screen.dart` | `POST /api/v1/login`; generic INVALID_CREDENTIALS; RATE_LIMITED (429 + Retry-After) visible |
| C — Home | `HomeScreen` | `lib/screens/home_screen.dart` | `GET /api/v1/home` protected; 401 UNAUTHENTICATED → back to login; logout invalidates the server session |
| D — Workbench | `NotesScreen` / `WorkbenchScreen` | `lib/screens/notes_screen.dart`, `lib/screens/workbench_screen.dart` | `GET/POST/PUT/DELETE /api/v1/notes*` CRUD + `GET /api/v1/algorithm` + `POST /api/v1/algorithm/run`; measured ms vs Big-O displayed separately |

Supporting files:

- `lib/api/envelope.dart` — 1:1 Dart mirror of the shared envelope
  normalization in `../laravel/resources/js/lib/envelope.ts`
  (`{ ok, data, error, requestId }`, defensive UNKNOWN fallback).
- `lib/api/api_client.dart` — envelope-aware client; the Laravel session
  cookie (`stack15_session`, HttpOnly) is captured from `Set-Cookie`,
  persisted in `flutter_secure_storage` (never plain preferences), and
  replayed on every request.
- `lib/main.dart` — bootstrap: restores the cookie, then shows Login (or
  Home when a session cookie was restored).

## Security notes

- The session cookie is stored only in `flutter_secure_storage`.
- No code input exists anywhere: the workbench picks from the fixed catalog.
- Input is capped at 10,000 characters client-side; the server re-validates
  and rejects oversized input with `INPUT_TOO_LARGE` (never truncates).
- The /api/v1 surface uses session-cookie auth without a CSRF token dance;
  cross-site POST abuse is mitigated server-side by SameSite=lax cookies and
  the failed-login rate limiter (see `../ARCHITECTURE.md`).

## Contract check without the Flutter SDK

The envelope normalization is mirrored in TypeScript and covered there:

```powershell
cd ../laravel
npm.cmd test        # vitest: resources/js/lib/envelope.test.ts
```

That suite asserts the same rules this directory's Dart code implements
(success unwrap, failure code/message/details, UNKNOWN fallback for foreign
bodies). The Dart implementation itself remains UNVERIFIED until a Flutter
SDK can run `flutter analyze && flutter test` (see `../verification.md`).
