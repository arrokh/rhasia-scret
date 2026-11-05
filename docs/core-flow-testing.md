# Core-flow testing policy

## Priority and scope

Automated tests protect user outcomes, confidentiality, authorization, and data integrity. A test earns its maintenance and runtime cost by identifying a concrete failure it would catch. Test count and pixel fidelity are not success criteria.

The six priority flows are:

1. **Setup Vault → unlock → add account → generate OTP.** Cover valid setup, wrong unlock material, encrypted account persistence, and correct OTP generation with fixed time and protocol vectors.
2. **Lock/logout clears keys and sessions.** Clear client workspace/key buffers immediately, invalidate the hosted session on logout, and prevent continued access. Locking a Vault is not the same as signing out; locking need not terminate the hosted session.
3. **Secrets stay inside authorized client boundaries.** Plaintext secrets, QR payloads, OTPs, unlock material, and private keys must not leak into server requests/persistence, logs, analytics, Query caches, or prohibited browser storage. Permitted encrypted persistence is not a leak. Memory-buffer zeroing assertions verify owned buffers, not a guarantee that the browser garbage collector erases every copy.
4. **Shared Vault invitations and access restrictions.** Cover redemption, expiry/replay, role enforcement on the server, and access loss after revocation. Hidden UI controls alone do not prove authorization.
5. **Backup/restore is safe.** Cover round-trip recovery, wrong keys, corrupt archives, explicit confirmation, and atomic failure without partial writes or loss of existing data.
6. **Offline/PWA preserves data and confidentiality.** Cover encrypted offline unlock/OTP, safe sync and revocation handling, failed refresh/update recovery, and update deferral during active sensitive operations.

These priorities do not permit dropping other irreversible or security-sensitive behavior, such as destructive reset/account deletion, passkey verification, and secret-scanning or authorization gates.

## Choose the cheapest reliable layer

- **Unit:** domain rules, parsing, fixed-time OTP vectors, crypto envelope failures, buffer ownership/lifecycle, and state transitions. Keep these deterministic and independent of services.
- **Integration/contract:** server authorization, database constraints/transactions, ciphertext-only payloads, session termination, and failure mapping. Use synthetic data and approved disposable databases.
- **Browser smoke:** an explicit small selection of core entry/actions, authentication guards, and a working Vault/account/OTP journey. An application journey that needs the real API belongs in the real-stack suite, not a preview with mocked success. Do not duplicate it merely to give it a smoke label.
- **Browser acceptance:** cross-layer core journeys and browser-dependent behaviors such as WebCrypto, IndexedDB, service workers, clipboard, touch, focus, and passkey adapters. Include representative failure safety checks that lower layers cannot prove.

Avoid repeating every edge case in a browser when a focused lower-layer test proves it. Keep a small real-stack journey to verify the layers connect. Synthetic authentication adapters do not prove delivery by an external email provider or real authenticator hardware.

## Cosmetic versus functional assertions

Remove or simplify tests whose only outcome is a particular color, shadow, spacing, footer alignment, icon absence, exact button height, animation camera position, skeleton geometry, or ordinary marketing/preview wording. Review appearance directly; visual consistency remains a design expectation, not a browser merge gate.

Keep functional accessibility: core actions must remain reachable and usable by keyboard and touch. Keep meaningful destructive confirmation, security/error warnings, and safeguards against data loss. A contrast check for a safety warning is not merely checking a preferred color. Match semantic outcomes rather than freezing incidental DOM structure or copy.

Text used as an accessible locator does not make a functional test cosmetic. Maintain Indonesian/English catalog parity, locale-independent contracts, validated locale-cookie behavior, and representative core-flow usability; avoid a full layout/copy matrix in both locales.

## Review and migration

For each proposed removal or simplification, record the failure protected, evidence in existing tests, replacement coverage if needed, and a keep/simplify/remove/add decision. Label a gap as confirmed only after reading relevant implementation and tests; a missing filename or browser scenario is not proof of missing unit coverage.

The approved pruning decisions and implementation status are recorded in [the core-flow test review](reviews/core-flow-test-review.md). Use the Playwright configs and gate-inventory test as the source of truth for executable selection. Obtain review before future test-pruning or gate changes; approval to simplify test content is not permission to weaken security scanning, alter branch protection, or change schedules. Existing required gates and the fresh full local verification requirement remain in force.
