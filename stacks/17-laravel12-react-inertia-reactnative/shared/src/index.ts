/**
 * Stack 17 shared layer — the single client-side contract consumed by BOTH
 * the React (Inertia) web app and the React Native (Expo) thin shell:
 *
 * - envelope types + normalization (parseEnvelope / normalizeEnvelope)
 * - the transport-agnostic ApiClient (inject your platform fetch)
 *
 * The wire format this code speaks is frozen by the Laravel contract tests
 * (laravel/tests/Feature/EnvelopeContractTest.php) and exercised end-to-end
 * by the real-HTTP smoke script (laravel/scripts/smoke.mjs).
 */
export * from './envelope.js'
export * from './api-client.js'
