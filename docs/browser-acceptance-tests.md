# Encrypted Vault browser acceptance tests

The dedicated Playwright suite in `src/tests/browser/encrypted-vault-workflows.spec.ts` exercises the real route, application, Prisma, browser-crypto, and presentation stack for Personal and Shared Vault workflows.

## Local setup

1. Install the repository toolchain and dependencies with `mise install && mise run setup`.
2. Provide the normal local PostgreSQL `DATABASE_URL` and `DIRECT_URL` values.
3. Apply migrations with `pnpm exec prisma migrate deploy`.
4. Install the Playwright browsers when needed with `pnpm exec playwright install`.
5. Run all browser suites with `pnpm run test:browser`. To run only the encrypted Vault matrix, use `pnpm exec playwright test --config playwright.e2e.config.ts`.

The dedicated configuration starts the development server, provisions isolated opaque test identities, and removes their application data before and after the run. Tests are retry-safe and use unique identities per browser and scenario. Chromium, Firefox, and WebKit execute sequentially because the production-strength Argon2 parameters make concurrent browser KDF work unreliable on constrained CI runners.

Chromium and Firefox run every encrypted workflow in CI. WebKit runs the Personal Vault and passkey workflows there, including repeated production-strength lock/unlock operations. The QR/account-recovery and multi-context Shared Vault scenarios are skipped only for WebKit when `CI=true`: in the repository's Linux CI environment, that engine can stall indefinitely while repeating the production-strength Argon2 workflow after data-heavy browser operations on the constrained runner. Those scenarios remain covered by Chromium and Firefox in CI and run without the skip on local WebKit, so the workaround neither changes production cryptography nor introduces a browser-crypto test implementation.

## Controlled external seams

Supabase sessions and WebAuthn attestation cannot be exercised deterministically in CI. The suite therefore provides narrowly scoped seams that:

- are enabled only when both `NODE_ENV=development` and `E2E_BROWSER_TESTS=1`;
- accept only identities listed in `E2E_BROWSER_TEST_USERS`;
- use an HTTP-only same-origin test cookie;
- replace only external passkey verification while retaining the real encrypted recovery-package workflow;
- remain disabled in production even if the E2E environment variables or cookie are present.

The Playwright configuration creates these values automatically. They must not be used for normal development identities.

## Security assertions

The tests inspect API requests and responses, console/page errors, Local Storage, Session Storage, IndexedDB, Cache Storage, TanStack Query state, and the unlocked workspace key buffers. Assertions fail if known plaintext Vault names, account labels, TOTP secrets or generated OTPs, Vault Unlock Secrets, invitation fragments, or decrypted key material cross or persist outside permitted client memory.

CI provisions PostgreSQL, applies migrations, runs the normal browser suites, and then runs this dedicated cross-browser matrix through `pnpm run test:browser`.
