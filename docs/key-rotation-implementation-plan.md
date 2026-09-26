# User-facing key-rotation workflows — implementation status (#186)

## Status

**The browser workflows and server-side rotation paths are implemented in this branch, but this work is not complete or release-ready until the integration, browser, documentation, and repository gates pass.** The Prisma schema is unchanged and no migration file was generated. The human authorized applying the existing migrations only inside disposable PostgreSQL test containers; no other database or deployment is authorized.

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

## Remaining work before completion

- Run the new Prisma integration tests for both rotation repositories in the authorized disposable PostgreSQL test container. Coverage includes atomic ciphertext/profile/member-wrap changes, redacted audits, stale account snapshots, changed exact member/account sets, pending-invitation invalidation, and concurrent writers. The container is isolated; do not use the unrelated PostgreSQL service at `127.0.0.1:55432`.
- Complete the expanded Chromium workflow. The latest full-gate run gets through Vault-key rotation and captures all four rotation surfaces in English/Indonesian at desktop/narrow widths, but fails during User Encryption identity-rotation preparation. An isolated run against a fresh disposable PostgreSQL container identified the strict-snapshot mismatch (`encryptionVersion`) and PATCH DTO omissions (`expectedEncryptionVersion`, `encryptionVersion`, and `expectedKeyVersion`); browser parsing, request creation, reconciliation, and unit assertions now match the route contract. The next isolated run confirmed both rotations commit, then timed out in the pending-invitation assertion: the test waited for a POST after the server correctly returned 404 to the initial Secure Share Link lookup GET, so no POST should occur. Updated the test to assert lookup GET 404 and the UI alert; this regression fix still needs browser verification. Viewer-after-rotation and remaining account-permission/deletion scenarios remain unverified. Cancellation/conflict/ambiguous-outcome recovery also remain to be exercised.
- Route-bundle optimizations: replaced the camera scanner's broad ZXing reader with the already-used lazy jsQR decoder, exposed rotation workflows through dedicated public entry points rather than route-facing barrels, and now load the QR importer only after the user requests camera scanning or image decoding. The two simple route-bound selectors use the shared accessible native `<select>` component. The unchanged full-route verifier counts every chunk, including the demand-loaded QR importer. Latest merged-tree totals pass: `/vaults` 735,310 raw / 223,584 gzip; `/vaults/manage`, `/vaults/manage/[vaultId]`, and `/vaults/accounts/new` each 727,633 raw / 221,267 gzip (limits: 750,000 / 225,000). Android release and iOS simulator native builds passed earlier in the branch.
- After resolving any findings, run the complete `pnpm run test:full` gate from the repository root. It applies existing migrations only to a disposable PostgreSQL container under the human's explicit authorization. Do not target the service at `127.0.0.1:55432` or any production database.
- The PR must then be updated with `Resolves #186` and `Related #228`, the existing unsigned commit must be rewritten with the required DCO trailer under the separately granted force-push authorization, and all GitHub Actions must pass before merge readiness can be assessed.

## Verification evidence so far

- After merging `main` at `47e0f2a`, root lint, typecheck, format check, web architecture tests, web/API/core unit tests, and `git diff --check` passed in the latest full run. Exact v9 counts: core 10 files / 59 tests, API 69 files / 372 tests, web 128 files / 494 tests; Chromium smoke 40/40 passed. The full gate is **not passing**: Chromium E2E has one failure in User Encryption identity-rotation preparation after Shared Vault key rotation.
- The merged-tree web production build passed output validation (71 client assets, 2,283,957 bytes; no forbidden server secrets). The unchanged route-bundle verifier passed: `/vaults` 735,310 raw / 223,584 gzip; `/vaults/manage`, `/vaults/manage/[vaultId]`, and `/vaults/accounts/new` each 727,633 raw / 221,267 gzip, below the 750,000 / 225,000 budgets.
- Both native Android release and iOS simulator builds passed earlier in the branch. Rotation-specific Prisma integration tests pass in the disposable container (19 files / 54 tests). The v9 disposable PostgreSQL testcontainer was cleaned up after failure; the only remaining PostgreSQL container is the unrelated `rhasia-scret-dev-db-1`, which was not touched.
- During post-v9 review, corrected the strict identity-rotation API contract mismatches: snapshot `encryptionVersion` was missing from browser parsing; PATCH `expectedEncryptionVersion` and `encryptionVersion` were missing; and membership compare-and-swap used `keyVersion` instead of `expectedKeyVersion`. Added client and route unit assertions plus version-aware reconciliation. These changes still require isolated browser E2E and a fresh full-gate run.
- The first complete `pnpm run test:full` attempt found owner-only Invitations/Security tabs overflowing at 320px on `/ui-preview/vaults` in Indonesian; that layout was fixed and subsequent Chromium smoke gates pass. The identity-rotation E2E initially timed out because it used an immediate `isVisible()` probe after navigation; the test now waits for the locked state and unlocks explicitly. The latest complete attempt (v9) reached the rotation scenario in 25.9s but failed during User Encryption identity-rotation preparation; see the latest log `/tmp/rhasia-test-full-postmerge-v9.log`. All eight screenshots (`vault-rotation-{id,en}-{desktop,narrow}.png` and `identity-rotation-{id,en}-{desktop,narrow}.png`) were generated and inspected. The two vault panels and both locales fit desktop/narrow widths; identity panels remain legible with text wrapping inside the narrow security sheet.
- The repository gate runs API migrations only in a disposable PostgreSQL test container. The human explicitly authorized this isolated verification in the current conversation; do not substitute the unapproved service at `127.0.0.1:55432`.

## Required final verification

Before declaring the issue complete, run from the repository root after the final code/config/documentation change:

- `pnpm run lint`
- `pnpm run typecheck`
- `pnpm test`
- `pnpm run test:architecture`
- `pnpm run build`
- `pnpm run test:full`

The Chromium browser workflow must be rendered and inspected; full-suite coverage alone is not a substitute for that inspection. Report any database-, browser-, or environment-blocked phase explicitly. No database migration or deployment may be performed without separate, current human authorization.

## Acceptance-criteria traceability

| Issue #186 criterion                                                   | Evidence required for completion                                                                                                                                  |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner can start, confirm, cancel, complete, and recover                | Owner-only UI tests and rendered Chromium flows for confirm, pre-submit cancel, success, conflict, interruption, and safe retry                                   |
| Vault rotation re-encrypts content and updates every member atomically | Crypto round trips and Prisma transaction/concurrency tests over active/recoverable records and the exact active-member set                                       |
| User-key rotation preserves access without server secrets              | Rotation round trips for all active memberships; API/persistence tests proving only public keys, encrypted private key, and opaque encrypted envelopes are stored |
| Concurrent changes reject/reconcile without partial replacement        | Prisma races against account writes/purge, invitation grant/redeem/revoke/leave, Vault lifecycle, concurrent rotation, and identity rotation                      |
| Failed/interrupted operation preserves valid data and offers retry     | Rollback and buffer-cleanup tests plus ambiguous-response reconciliation in browser coverage                                                                      |
| Native work remains separate                                           | #228 retains native rotation UI/orchestration; only compatibility needed for ECDH reads/current-generation writes is included here                                |
| Audit, rate limit, localization, and sensitive-data boundaries hold    | Redacted owner-visible audit tests, rate-limit/route-parity tests, exact en/id catalog parity, stale recipient-key rejection, and browser/server boundary checks  |
