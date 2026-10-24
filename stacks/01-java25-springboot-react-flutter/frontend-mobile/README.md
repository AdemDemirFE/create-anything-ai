# frontend-mobile (Flutter)

Four-screen journey mapping (register, login, protected home, algorithm
workbench) for the Stack 01 backend contract.

> **STATUS: UNVERIFIED.** The Flutter SDK is not available in the
> implementation environment, so this code has never been compiled, analyzed,
> or tested. It is written strictly against the documented API contract in
> `../ARCHITECTURE.md` and `../verification.md`. Do not claim it works until
> `flutter analyze` and `flutter test` have been run in an environment with the
> SDK installed.

## Layout

```text
lib/
├── main.dart                    # app entry; restores session cookie
├── api/api_client.dart          # envelope client + ApiError + session cookie
└── screens/
    ├── register_screen.dart     # Journey A: POST /api/v1/register
    ├── login_screen.dart        # Journey B: POST /api/v1/login
    ├── home_screen.dart         # Journey C: GET /api/v1/home (protected)
    └── algorithm_screen.dart    # Journey D: fixed catalog + bounded input
test/
└── api_client_test.dart         # NOT RUN (no SDK) - documents intended behavior
```

## Contract notes

- Base URL defaults to `http://10.0.2.2:8080` (Android emulator → host
  localhost); change per device/deployment.
- Authentication uses the opaque `STACK01_SESSION` cookie returned by
  `/api/v1/login`. It is captured from `Set-Cookie`, replayed on every request,
  persisted with `flutter_secure_storage` (Keychain/Keystore), and cleared on
  logout. It is never stored in plain preferences.
- CSRF: the backend re-issues an `XSRF-TOKEN` cookie on every response; the
  client captures it and echoes it as the `X-XSRF-TOKEN` header on POST calls
  (register/login are exempt server-side). 429 responses (login throttle) map
  to `ApiError(statusCode: 429)`.
- All responses use the repository envelope; `ApiError` carries the stable
  error codes documented in `../ARCHITECTURE.md` §3.
- 401 on any protected call routes back to `LoginScreen`.

## Running (in an environment WITH the SDK)

```bash
flutter pub get
flutter analyze
flutter test
flutter run   # with the backend running on the host: cd ../backend && mvnw spring-boot:run
```
