# Testing Strategy

## 1. Test pyramid

### Unit
Test pure functions, manifest validation, template rendering, argument parsing, error mapping, and domain logic.

### Integration
Test database migrations, persistence, authentication, service-to-service contracts, cache behavior, and managed service adapters where feasible.

### Contract
Validate API request/response shapes, error codes, pagination, and compatibility between backend DTOs and client types.

### End-to-end
Exercise registration, login, protected dashboard, logout, and algorithm workbench. For native apps, document platform-specific smoke checks.

### Security
Run secret scanning, dependency audit, static analysis, authorization tests, and focused abuse-case tests.

## 2. Generator tests

Must cover:
- valid stack and target;
- unknown stack;
- invalid or missing manifest;
- missing template files;
- target exists and is non-empty;
- path traversal and symlink escape;
- dry-run has no side effects;
- output contains no forbidden secret placeholders;
- deterministic file listing;
- failure cleanup and exit codes;
- Windows path handling if Windows is supported.

## 3. Four-screen tests

- Register validation and persistence.
- Duplicate account behavior.
- Login success/failure and rate limit where supported.
- Unauthenticated protected-route/API denial.
- Logout and session invalidation.
- Algorithm input bounds and output correctness.
- Execution timing is present when supported.
- Loading, empty, and error states.
- Basic keyboard navigation and accessible labels.

## 4. Test data

- Use synthetic identities and fake data only.
- Never reuse real email/password combinations.
- Do not include production-like secrets that might match real credentials.
- Keep seeds idempotent or clearly resettable.
- Demo accounts are development-only and disabled in production.

## 5. Flaky tests

- Capture reproducible evidence.
- Do not hide intermittent failures with unlimited retries.
- Retry only known transient infrastructure failures and report the original failure.
- Assign an owner and issue for unresolved flaky tests.
