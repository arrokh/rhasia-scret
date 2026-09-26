# Passwordless-only hosted authentication plan

## Status

Accepted for implementation under [GitHub issue #185](https://github.com/arrokh/rhasia-scret/issues/185). The issue's original Identity Linking and Provider Migration scope is superseded.

## Goal

Make self-managed email-link passwordless authentication the only supported hosted sign-in method while preserving the current passwordless behavior. Keep `AUTH_BACKEND=none` as the intentional local-only mode.

When passwordless is enabled, the hosted sign-in form remains email-only. Local Vault and Offline remain distinct unauthenticated choices: Local Vault is independently writable; Offline opens the read-only Local Vault Snapshot for a previously synchronized hosted Personal Vault.

## Decisions and invariants

- No deployment, integration, Application User, or user data currently uses OIDC. No OIDC-to-passwordless account migration, dual-auth rollout, or backward-compatibility path is needed.
- Remove OIDC as an active runtime/configuration option, including its sign-in and account-deletion reauthentication paths. Preserve historical ADRs, audits, release records, and Prisma migration history as historical artifacts.
- Keep only `none` and `passwordless` as valid `AUTH_BACKEND` values. `none` remains local-only and fails closed for hosted APIs. An explicit `oidc` value must fail as unsupported, not silently fall back to passwordless or `none`.
- Preserve the provider-neutral `ExternalIdentity` model and its existing passwordless records. Do not change the Prisma schema or create/apply a database migration.
- Do not implement Identity Linking or Provider Migration. Remove the unused, incomplete linking-only primitives and their tests so they do not imply a supported flow.
- Do not alter passwordless semantics: challenge creation/redemption, SMTP delivery, Turnstile, anonymous rate limiting, browser/native session and refresh behavior, logout/revocation, PWA handoff, or passwordless Account Deletion OTP reauthentication.
- OIDC removal may require narrow edits in files that also compose passwordless. Make no unrelated refactors; treat existing passwordless contracts and tests as invariants and retain/add regression coverage.
- Keep Local Profile, Local Vault, Local Vault Snapshot, and their offline behavior unchanged. Do not call the Local Profile a local authentication account.
- Do not inspect, edit, print, or commit ignored local `.env` / `.env.prod` files. Remove OIDC settings from tracked environment templates and validators only. If a local ignored file still selects `oidc`, fail closed and require the operator to change it manually.
- A future authentication adapter is possible only after a separate explicit architecture/security decision; do not keep dormant OIDC support for that hypothetical future.

## Progress

| Plan section                                                 | Status                           | Evidence / next step                                                                                                              |
| ------------------------------------------------------------ | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 1. Record the settled domain and architecture                | Complete                         | CONTEXT.md, ADR-0053, ADR-0039 status, and docs index updated.                                                                    |
| 2. Reduce backend configuration to `none` and `passwordless` | Implemented; focused checks pass | API/web runtime types and deployment validators accept only supported backends; explicit `oidc` fails closed.                     |
| 3. Remove API OIDC runtime and routes                        | Implemented; focused checks pass | OIDC verifier/admission and deletion routes/primitives removed; passwordless sessions, OTP, and provider-neutral identity remain. |
| 4. Remove web OIDC runtime and preserve sign-in composition  | Implemented; focused checks pass | Callback routes/adapters and provider branch removed; passwordless, Local Vault, and Offline composition retained.                |
| 5. Update deployment and verification surfaces               | Implemented; focused checks pass | Compose/env/test matrix/dependency updated; unsupported-backend, route, and passwordless regression coverage added.               |
| 6. Refresh current documentation and localization            | Implemented; focused checks pass | Current docs, route manifest, privacy/security guidance, and both locale catalogs updated; historical records retained.           |

## Implemented behavior

- `apps/web/src/app/sign-in/page.tsx` renders the email-link form only for `passwordless`, keeps the hosted-auth-disabled state for `none`, and retains distinct Local Vault and Offline links in both modes.
- Passwordless web/PWA/native flows remain unchanged: one-time magic-link challenges, Turnstile and rate limits, database-backed sessions, browser assertions, native refresh rotation, installed-PWA handoff, and Account Deletion OTP reauthentication.
- API and web runtime/deployment configuration accepts only `none` and `passwordless`; `oidc` fails closed. OIDC adapters, callbacks, and OIDC-only Account Deletion reauthentication are removed.
- `ExternalIdentity` and the `ApplicationUser` relationship remain provider-neutral. Passwordless continues using issuer `rhasia:passwordless`; the schema, uniqueness constraints, and user IDs are unchanged.
- The unused API and web identity-linking primitives and their linking-only tests are removed. No user-facing Provider Migration implementation existed or was added.

## Implementation plan

### 1. Record the settled domain and architecture

1. Update `CONTEXT.md` so Authentication Provider describes the currently supported self-managed passwordless method; Application Admission describes verified email-link admission; and Identity Linking/Provider Migration are no longer current product terms.
2. Add an accepted ADR superseding the OIDC-availability portions of ADR-0039 and the related current OIDC-support claims in other architecture records. Keep provider-neutral identity persistence and require a separate decision for any future adapter.
3. Keep historical ADR/audit/release/migration records intact; update only current operating guidance and mark the applicable prior architecture decision as superseded by the new ADR where appropriate.

### 2. Reduce backend configuration to `none` and `passwordless`

1. Update API and web authentication configuration unions/parsers and composition to accept only `none` and `passwordless`.
2. Remove OIDC-only binding/configuration fields from active runtime types and environment allowlists, deployment validators, Compose service forwarding, tracked `.env.example`, local workspace environment loaders, and test-server setup.
3. Preserve explicit production `AUTH_BACKEND` validation, passwordless defaults outside production, and existing fail-closed error behavior. `AUTH_BACKEND=oidc` must be rejected as unsupported.
4. Remove OIDC-only packages after proving they are unused elsewhere (`openid-client` is currently declared by the web package; retain shared dependencies such as `jose` when passwordless still uses them). Regenerate the root `pnpm-lock.yaml` only through pnpm.
5. Do not edit ignored local environment files or expose their values in logs/chat.

### 3. Remove API OIDC runtime and routes

1. Remove OIDC verifier/terminator/admission composition and OIDC-specific identity infrastructure from `apps/api/src/modules/identity`; preserve passwordless session verification and the `none` verifier.
2. Remove OIDC-only Account Deletion route handlers, route registrations, repository port methods, OIDC challenge purpose/creation/completion code, and its challenge-cookie handling.
3. Keep the passwordless Account Deletion OTP request/verify path and its policy, authorization, rate limits, persistence, localized errors, and final deletion flow unchanged.
4. Account-deletion ledger storage may remain generic/string-backed; do not change schema or historical rows. Runtime Account Deletion metadata should identify the sole supported backend as passwordless.
5. Remove the unexposed API `linkIdentity` application primitive and `PrismaIdentityLinkRepository`. Preserve `IdentitySecurityEvent` and passwordless security-event behavior.
6. Update route parity and mutation inventory tests to remove OIDC deletion operations while retaining all passwordless routes and authorization checks.

### 4. Remove web OIDC runtime and preserve the sign-in composition

1. Remove `/auth/oidc` and `/auth/oidc/callback`, OIDC client/session/proxy-verifier code, OIDC callback cookies, OIDC return-path handling, and OIDC origin allowlisting.
2. Remove the OIDC branch from web auth configuration, root layout config validation, proxy composition, server API gateway, and Account Deletion presentation/client.
3. Keep the existing passwordless sign-in form and the separate Local Vault and Offline links. In `none` mode, keep the no-hosted-auth state and those independent choices.
4. Remove the duplicate unexposed web identity-linking primitive and its linking-only test. Do not add an alternative multi-email linking feature.
5. Remove OIDC analytics callback-path special cases only where they become unreachable; preserve the current analytics redaction policy for all remaining routes.

### 5. Update deployment and verification surfaces

1. Remove the OIDC browser E2E configuration and dedicated `test:browser:oidc` scripts. Keep supported Chromium browser coverage for passwordless, local-only, offline, PWA, and account deletion.
2. Remove OIDC-specific contract/unit cases for deleted routes/adapters. Keep provider-neutral persistence tests where they exercise `ExternalIdentity` invariants, using synthetic identities without claiming OIDC runtime support.
3. Add/adjust configuration tests proving `none` and `passwordless` remain valid and `oidc` fails closed in both API and web composition/deployment validation.
4. Add/retain browser and route tests proving:
   - passwordless mode has only the email magic-link sign-in method;
   - `none` mode has no hosted email form;
   - Local Vault and Offline remain visible/usable as their independent paths;
   - passwordless Account Deletion continues to use its existing OTP reauthentication;
   - removed OIDC callback and deletion endpoints are not registered.
5. Keep browser tests on Chromium only, consistent with the repository support decision.

### 6. Refresh current documentation and localization

1. Update `README.md`, `docs/authentication-configuration.md`, `docs/self-hosting.md`, `docs/README.md`, deployment/security guidance, browser-test docs, API route-parity manifest, and current privacy disclosures to remove OIDC as a supported method and describe `none`/passwordless accurately.
2. Update `apps/web/messages/{en,id}.json` and `apps/api/src/messages/{en,id}.json` together, removing OIDC-only copy and preserving exact key parity. Keep Indonesian and English sign-in, local-only, offline, Account Deletion, validation, and error states complete.
3. Preserve prior release evidence, completed audit reports, immutable migration SQL, and superseded ADR content as historical records. Do not perform a repository-wide blind replacement of historical OIDC mentions.
4. Add this plan to the implementation-plan index and link the plan from issue #185.

## Suggested execution slices

1. `[docs] Record passwordless-only hosted authentication decision`
2. `[api] Remove OIDC backend composition and deletion reauthentication`
3. `[web] Remove OIDC callbacks and retain passwordless/local/offline sign-in`
4. `[identity] Remove incomplete linking primitives and OIDC-only tests`
5. `[config] Remove OIDC deployment variables and test matrix`
6. `[docs] Align current operating guidance and bilingual copy`
7. `[test] Verify passwordless invariance and unsupported OIDC behavior`

Each slice must keep the passwordless contract passing; do not merge an intermediate state that drops hosted sign-in.

## Verification plan

- Run focused API/web auth configuration, Account Deletion, route-parity, identity, sign-in-rendering, PWA/native contract, and browser tests during implementation.
- Verify catalogs have exact Indonesian/English key parity and unsupported `oidc` configuration fails closed without silently selecting another mode.
- Verify no active OIDC routes, runtime adapters, deployment variables, or OIDC-only dependency remain. Historical ADR/audit/migration references are expected and must not be erased.
- Verify the `ExternalIdentity` schema and passwordless account provisioning remain unchanged; no database migration or data operation is part of this issue.
- Run the required root checks: `pnpm run lint`, `pnpm run typecheck`, `pnpm test`, `pnpm run test:architecture`, `pnpm run build`, and the fresh final `pnpm run test:full` before merge/PR handoff. Do not claim completion if an environment-blocked phase has not passed.
- Do not deploy, merge, or modify a database under this plan. Database operations require separate, explicit environment-specific human authorization.

## Verification status

Focused verification results:

- API suite in explicit no-database mode: 49 files passed, 17 DB-backed files skipped; 303 tests passed, 45 DB-backed tests skipped. Web suite: 121 files, 473 tests passed.
- With current authorization, disposable Testcontainer migrations, passwordless preflight/seed/staged verification passed; isolated DB-backed API integration passed (17 files, 45 tests).
- The first root `pnpm test` attempt exited 1 from the API `test:container` wrapper, but its monitor buffer omitted the nested diagnostic. After the Expo dependency/lockfile fix, a fresh root `pnpm test` passed: release-evidence 4, client-vault-core 50, API 66 files/348 tests, API contract 3, API client 2, web 121 files/473 tests, and mobile 24 suites/99 tests. The earlier failure was not reproduced; the exact cause remains unavailable from its truncated monitor output. Test migrations ran only in the authorized disposable Testcontainer.
- The first fresh root `pnpm run test:full` exited 1 at mobile `expo-doctor` because SDK 57 expected `expo ~57.0.25`, `expo-linking ~57.0.11`, and `expo-sharing ~57.0.22`, while the manifest had preceding patch versions. These versions and the `expo-modules-jsi@57.1.1` compatibility patch are now aligned; complete mobile verification passes (lint, typecheck, 24 suites/99 tests, Expo Doctor 21/21, iOS/Android release bundles).
- The fresh final root gate `PLAYWRIGHT_E2E_WORKERS=2 mise exec -- pnpm run test:full` passed completely. It covered 50 client-vault-core tests, 3 API-contract tests, 2 API-client tests, 348 API tests, 473 web tests, and 99 mobile tests; API/web builds, route-bundle budgets, Vercel bundles, Expo Doctor (21/21), and iOS/Android release bundle exports also passed. Chromium browser coverage passed: 40 smoke, 8 DB-backed E2E, and 5 offline-PWA tests. Database migrations and E2E test data remained inside the authorized disposable PostgreSQL Testcontainer.
- Local three-worker browser runs intermittently failed different UI-state transitions, while full smoke→E2E→PWA replays with one and two E2E workers passed; two workers matches CI configuration. The E2E setup helper now asserts the custom-passphrase radio is selected before filling its conditional field, avoiding an opaque 10-minute locator timeout. No production-code change was made for these non-reproducing failures.
- Lockfile-only resolution and final frozen installation pass with pnpm 11.17.0. The lockfile contains the intended OIDC dependency removals and Expo SDK patch/transitive updates; Pnpm also changed one Vitest coverage peer context from `jsdom@30.0.1` to `30.1.0`. The complete fresh root gate passed with that lockfile.
- API contract: 3 tests; API client: 2 tests; client-vault-core: 10 files, 50 tests; mobile JavaScript: 24 suites, 99 tests.
- CI/self-hosted helper tests: 22 tests; release-evidence tests: 4 tests. API and web deployment validators accept synthetic `none`/`passwordless` configurations and reject explicit `AUTH_BACKEND=oidc`; self-hosted validator tests pass.
- Frozen-lockfile installation, root lint, typecheck, architecture checks, build, CI policy/version checks, dependency license check, Prettier/Prisma format checks, and `git diff --check` pass.
- Targeted Chromium passwordless sign-in/configuration smoke checks, passwordless installed-PWA handoff, and three offline-PWA regression scenarios pass. API route-parity confirms removed OIDC deletion endpoints return 404; the production build route manifest contains no OIDC callback routes; sign-in smoke verifies email-only hosted sign-in and independent Local Vault/Offline links.

## Issue acceptance evidence map

| Acceptance criterion                                                                                     | Evidence                                                                                                                                                                                                                                                                       | Status   |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| Passwordless is the sole hosted backend; `none` works; `oidc` fails closed.                              | API/web backend tests, self-hosted validator tests, and direct API/web deployment-validator checks: synthetic `none`/`passwordless` configurations accepted, explicit `oidc` rejected.                                                                                         | Verified |
| No active OIDC sign-in, callback, session, deletion-reauth, or deployment path remains.                  | Removed adapters/routes/primitives; API tests assert deleted deletion routes return 404; Next production route inventory omits callbacks; tracked env/Compose/lockfile and active-code searches show no OIDC implementation or dependency (only stale-setting filters remain). | Verified |
| Passwordless sign-in offers email only; Local Vault/Offline links remain; `none` shows no hosted form.   | Chromium sign-in smoke asserts email action, no OIDC link, and separate Local/Offline links; `SignInPage` unit test asserts `none` omits the email form and retains both links.                                                                                                | Verified |
| Existing passwordless web/PWA/native and deletion OTP behavior has regression coverage.                  | Web/API unit tests, API deletion OTP request/verify and completion tests, passwordless PWA handoff, mobile JavaScript tests, DB-backed Account Deletion browser E2E, and the full 8-test Chromium E2E suite pass in the fresh root gate.                                       | Verified |
| Local Vault stays independent/writable; Offline stays a read-only snapshot.                              | Existing web/mobile unit suites and three Chromium offline-PWA regressions pass; sign-in retains separate `/local` and `/offline` routes.                                                                                                                                      | Verified |
| Linking/migration is not exposed or described as supported; `ExternalIdentity` remains provider-neutral. | Removed API/web linking code/tests; architecture test verifies removed entry points; provider-neutral identity test passes and the Prisma schema diff is empty.                                                                                                                | Verified |
| Current docs and both locale catalogs are accurate; historical records remain.                           | Updated current docs, ADR-0053/ADR-0039 status, API route-parity docs, and English/Indonesian catalogs; catalog/unit tests and formatting pass, while historical ADR/audit/release/migration records remain intact.                                                            | Verified |
| No schema change, migration, email-based identity merge, or OIDC data migration is introduced.           | No Prisma schema/migration files changed. Migrations ran only in the authorized disposable Testcontainer for verification; no existing database was touched and no email-match merge was added.                                                                                | Verified |

The final full gate passed with CI-matched E2E concurrency. Earlier three-worker browser failures were not reproduced by the one- and two-worker full browser-gate replays or the final root gate. No Prisma schema or migration files were changed; all migration/test-data operations were confined to the explicitly authorized disposable PostgreSQL Testcontainers, and no non-disposable database was touched.

## Done when

All issue acceptance criteria pass, passwordless behavior is unchanged across supported web/PWA/native surfaces, Local Vault and Offline remain separate, OIDC is unsupported and absent from active runtime/configuration, current docs/locales agree, and the full required verification gate passes.
