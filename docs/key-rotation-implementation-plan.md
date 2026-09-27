# User-facing key-rotation workflows — implementation status (#186)

## Status

**Both browser rotation ceremonies and their server-side transactions are implemented, and the post-review working tree passes the complete repository gate recorded below.** Merge readiness remains subject to checks on the final published head and required review approval. The Prisma schema is unchanged and no migration file was generated. Database-backed verification used disposable PostgreSQL test containers only; no other database or deployment was authorized.

Issue: [#186 — Complete user-facing key rotation workflows](https://github.com/arrokh/rhasia-scret/issues/186)

## Goal and boundaries

Deliver two deliberate, manually initiated, browser-only ceremonies:

1. **Vault Encryption Key Rotation** replaces the key for one active Shared Vault, re-encrypts the Vault Name and all retained Authenticator Accounts locally, and updates every active member envelope in one server transaction.
2. **User Encryption Key Pair Rotation** replaces a user's ECDH identity and re-wraps the Vault Encryption Key in every active Shared Vault membership in one server transaction.

The server receives only encrypted content/key material and permitted authorization/lifecycle metadata. Personal Vault encryption is unchanged. There is no scheduler or background rotation. Native rotation UX/orchestration remain separately tracked in [#228](https://github.com/arrokh/rhasia-scret/issues/228); the minimal native read/write compatibility needed for Shared Vaults after browser rotation is included here.

Rotation cannot erase keys, ciphertext, or TOTP secrets already obtained by an authorized member or device. Suspected TOTP-secret exposure still requires resetting the affected credentials at their original services.

## Implemented behavior in this branch

### Crypto and compatibility

- Rotation helpers process records sequentially, bind key wraps to Vault/member/generation context, cooperate with cancellation between crypto operations, and clear owned temporary plaintext/ciphertext/key buffers on failure or cancellation.
- New Shared Vault member key packages use context-bound ECDH Key-Wrap Envelopes. Readers retain strict compatibility for existing User-Root-Key-encrypted packages; they do not fall back to another decryptor after authentication failure.
- Native clients can read the ECDH envelope format and submit Shared Vault account/archive writes with the current key generation. Native rotation UX remains out of scope.
- Personal Vault offline snapshots continue to exclude User Encryption private identity material.

### Server persistence and concurrency

- The owner-only Vault rotation snapshot returns opaque IDs, ciphertext, retained-account revisions/deletion state, member public keys/generations, and pending invitation count. Count, ciphertext, and total request/response bounds are enforced.
- Vault rotation rechecks the expected current generation, exact active member set/public keys, expected encrypted-name snapshot, and every retained-account revision under Vault/member/account row locks. It updates all ciphertext and envelopes, increments account revisions, invalidates pending Secure Share Links, and appends one redacted audit event in the same transaction.
- User identity rotation reads the encrypted identity profile and active Shared Vault memberships from one PostgreSQL `RepeatableRead` snapshot, then atomically updates the profile plus every membership. User-level advisory locks serialize it with identity registration/root-key updates, account deletion/reset, Shared Vault creation, and membership operations; Vault/member locks serialize it with Shared Vault key operations. The identity encryption protocol version is not repurposed as a compare-and-swap revision.
- Shared account create/update, archive import into an existing Shared Vault, Vault rename, Secure Share Link creation, and invitation redemption validate the expected key generation while holding the Shared Vault row lock. Invitation redemption also validates the expected recipient public key under the recipient identity lock, so a stale browser cannot install a key wrap for a replaced identity. Shared Vault creation and creation through archive import validate the expected owner public key under the identity advisory lock. Stale writes fail closed instead of persisting ciphertext prepared with an old key.
- Both rotation mutations require fresh authentication and the existing `key_material_mutation` rate limit. Strict API schemas reject unsupported fields/private JWK fields; errors are bounded and do not include raw crypto or decrypted content.
- Successful rotations append redacted owner-visible audit events. Failed, cancelled, and rejected operations do not append success events.

### Browser workflow and presentation

- Browser infrastructure workflows prepare ciphertext locally, submit one atomic mutation, reconcile ambiguous outcomes against a fresh server snapshot, and only permit retry from refreshed state. They stay outside TanStack Query. Their stable public surfaces are the dedicated `apps/web/src/modules/identity/key-rotation.ts` and `apps/web/src/modules/vault-management/key-rotation.ts` entry points, keeping the route-facing context barrels from pulling workflow implementations into unrelated routes.
- Shared Vault Details exposes an owner-only security panel with affected-record/member/invitation summary, confirmation, preparation cancellation, progress, status reconciliation, and refresh/retry states. Viewer and Personal Vault surfaces do not expose Vault-key rotation.
- The unlocked Personal Vault security sheet exposes User Encryption Key Pair rotation with a local membership count, confirmation, cancellation, progress, reconciliation, and refresh handling.
- Visible copy and status messages are localized in English and Indonesian. The affected preview composition and browser regression coverage are updated. Preview data remains synthetic.

## Decisions and safety constraints

- New Shared Vault wraps use the already accepted context-bound ECDH Key-Wrap Envelope protocol from ADR-0038. Existing User-Root-Key packages remain readable until their Vault is rotated; wrapper dispatch is strict.
- Pending Secure Share Links are invalidated in the same successful Vault-key rotation transaction because their packages contain the old Vault Encryption Key and cannot be rewrapped by the server. The owner is warned to recreate them.
- Rotation includes active and still-recoverable accounts. Missing/unreadable records, stale snapshots, unavailable member keys, and size-limit failures abort the whole operation; there are no partial/chunked commits.
- An ambiguous response is reconciled before retry. Caller-owned workspace keys are not zeroized; only buffers owned by a workflow are cleared.
- No database schema change, deployment, or production operation is part of this implementation. The isolated test-container migrations are separately authorized by the human for verification; this plan does not authorize operations against any other database.

## Release and merge gates

- The final post-review `mise exec -- pnpm run test:full` run passed on the current working tree; exact evidence and logs are recorded below. Rerun the complete gate after any later source or configuration change.
- Before merge, incorporate all review fixes in a DCO-signed commit, push the final head, verify all required checks on that exact head, and obtain the required review approval. This plan does not authorize a merge.
- The existing migration suite runs only in a disposable PostgreSQL test container. Do not target `127.0.0.1:55432` or any production database. No schema change, migration file, or deployment is part of this implementation.

## Verification evidence

- `mise exec -- pnpm run test:full` passed after the review-address fixes. Log: `/tmp/rhasia-test-full-review-address-final.log`. This includes root formatting, lint, typecheck, unit/integration/contract tests, architecture checks, production build, performance bundle enforcement, Chromium smoke/E2E, mobile JS verification, and offline PWA coverage.
- Test totals: client-vault-core 10 files / 59 tests; API contract 3; API client 2; API 69 files / 373 tests; web 128 files / 496 tests; mobile 24 suites / 100 tests. Chromium smoke 40/40, real-stack E2E 8/8, and PWA 5/5 passed.
- The production web build verified 71 client assets (2,283,587 bytes) with no source maps or forbidden server secrets. Route budgets passed: `/vaults` 736,257 raw / 223,660 gzip; `/vaults/manage`, `/vaults/manage/[vaultId]`, and `/vaults/accounts/new` each 728,580 raw / 221,343 gzip (limits 750,000 / 225,000).
- The final gate's database migrations and integration tests used only its disposable PostgreSQL test container. The container was removed after the run; the unrelated `rhasia-scret-dev-db-1` was not accessed. The first review-address full-gate attempt stopped at Prettier because of one test-file formatting issue; formatting was corrected and the complete final run passed.
- The browser E2E covers both successful rotations, member access after rotation, pending Secure Share Link invalidation, and desktop/narrow English/Indonesian layouts. Focused component tests cover confirmation, preparation cancellation/discard, and ambiguous-outcome status recovery; crypto and Prisma tests cover cancellation/failure cleanup and atomic conflict handling. The real-stack E2E does not inject every conflict or network interruption; those cases are covered at their owning unit/integration layers.
- Android release and iOS simulator builds passed earlier in the branch; they were not rerun after these review-address changes. The complete current gate does include mobile JS verification.

## Required verification for later changes

Rerun the complete `mise exec -- pnpm run test:full` gate from the repository root after any source or configuration change, and before merge. It exercises database migrations only against a disposable PostgreSQL container. Chromium coverage remains the supported browser gate; do not add Firefox/WebKit. Report any database-, browser-, or environment-blocked phase explicitly. No migration or deployment may target any other database without separate, current human authorization.

## Acceptance-criteria traceability

| Issue #186 criterion                                                   | Evidence in the current implementation                                                                                                                                                                                                      |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner can start, confirm, cancel, complete, and recover                | Owner-only presentation tests cover preparation, confirmation, cancellation/discard, and ambiguous-outcome reconciliation without resubmission; real-stack Chromium covers successful Vault and identity rotations.                         |
| Vault rotation re-encrypts content and updates every member atomically | Core crypto round trips validate re-encrypted name/accounts; Prisma integration tests cover active/recoverable records, exact member/account sets, stale revisions, atomicity, and concurrency; Chromium confirms active member access.     |
| User-key rotation preserves access without server secrets              | Crypto round trips cover active memberships; Prisma tests verify atomic profile/member-wrap updates and redacted audit; API and browser tests enforce encrypted/private-key boundaries.                                                     |
| Concurrent changes reject/reconcile without partial replacement        | Prisma transaction and route tests cover stale expected snapshots and atomic rejection; browser component tests exercise ambiguous-result reconciliation without resubmission.                                                              |
| Failed/interrupted operation preserves valid data and offers retry     | Core crypto tests cover cancellation/failure buffer cleanup; presentation tests cover cancel and ambiguous-result recovery; Prisma transaction tests ensure atomic replacement. Full-stack network interruption is not separately injected. |
| Native work remains separate                                           | #228 retains native rotation UI/orchestration; only compatibility needed for ECDH reads/current-generation writes is included here.                                                                                                         |
| Audit, rate limit, localization, and sensitive-data boundaries hold    | Redacted owner-visible audit tests, rate-limit/route-parity checks, exact en/id catalog parity, stale recipient-key rejection, browser boundary coverage, and Chromium layout verification.                                                 |
