# rhasia-scret — MVP Plan

## Outcome

Build an installable, web-based, zero-knowledge shared authenticator. Users create or access hosted Application Users through verified Supabase email links. Each user has one non-deletable Personal Vault; owners can create Shared Vaults, invite exact recipients with encrypted one-time links, and viewers can locally generate and copy TOTP codes. The server enforces authorization and persists encrypted content plus only required authorization/lifecycle metadata; it never receives plaintext TOTP secrets, OTPs, raw QR data, vault names, vault keys, private keys, or Vault Unlock Secrets.

This plan is implemented as vertical slices. A slice is complete only with its domain behavior, application use case, persistence/adapter, API contract, usable UI, forbidden-path test, sensitive-data review, and boundary checks.

## Authoritative language and decisions

`CONTEXT.md` is the glossary. `docs/adr/` records hard-to-reverse decisions. The most important commitments are:

- The server is **honest-but-curious**. It protects encrypted data at rest and in normal server access, but an actively malicious web host that changes delivered JavaScript is outside the MVP threat model.
- Supabase Auth public passwordless email signup with Confirm email is the hosted registration mechanism. There is no `allowed_emails` table, application admin UI, or application registration API in the MVP; Shared Vault invitations remain separate authorization grants.
- Authentication and encryption are separate. A user creates a Vault Unlock Secret: at least four randomly generated words, never a PIN, never recoverable, and distinct from Supabase credentials.
- Argon2id derives a Vault Unlock Key. That key wraps a random User Root Key. The User Root Key protects the Personal Vault Encryption Key and encrypted user private key, allowing passphrase changes without re-encrypting accounts.
- A Remembered Browser uses Local Verification (WebAuthn user verification) to unlock client-local protected key material after normal authentication. The vault stays unlocked until explicit lock or logout; there is no automatic timeout. Browsers without Local Verification require the Vault Unlock Secret.
- AES-256-GCM encrypts payloads. P-256 ECDH, HKDF-SHA-256, and AES-256-GCM create versioned Key-Wrap Envelopes.
- Vault names, account issuer/name, and normalized TOTP configuration are encrypted vault content. Before unlock, the UI uses generic locked labels.
- A Shared Vault has exactly one Owner and zero or more Viewers. Owners always manage accounts, membership, permissions, recovery, and lifecycle. Viewers use accounts and may add, replace, or soft-delete them only through Effective Shared Vault Account Permissions resolved independently from Vault-wide defaults and nullable per-member overrides; they may leave but cannot list members or audit history.
- Owners may invite an exact email recipient before that person has initialized crypto. The owner client makes a recipient-bound, one-time Secure Share Link and delivers it through a secure out-of-band channel. The recipient signs up or signs in, completes enrollment, redeems the link, and receives Shared Vault access without the owner returning. Secure Share Link expiry/cancel/reissue is deferred.
- Membership revocation immediately denies future online access and removes the local snapshot on next successful contact. It cannot erase copied secrets or offline caches; owners must reset the original service's 2FA for full credential revocation.
- Shared Vaults and accounts soft-delete for 30 days and only owners may restore them. Personal Vaults cannot be deleted. Vault audit history is owner-only, opaque-ID-only, and retained one year after vault deletion.
- The PWA permits read-only offline use from encrypted Local Vault Snapshots. It blocks and never queues offline writes. Installation is optional.

## Bounded contexts and layering

Each context owns `domain/`, `application/`, `infrastructure/`, and, where needed, `presentation/`:

- **Identity**: Supabase session identity, application-user provisioning, user status.
- **Vault Management**: Personal/Shared Vault lifecycle, encrypted name payload, ownership, deletion/recovery.
- **Vault Membership**: Owner/Viewer authorization, invitations, grants, revocation, secure share links.
- **Authenticator Account**: encrypted normalized configurations, revisions, deletion/recovery, ordering.
- **Crypto** (client): unlock hierarchy, user key pairs, envelopes, encryption versions, Local Verification integration.
- **OTP Runtime** (client): parse and validate supported `otpauth://totp` configurations, generate and format codes, countdown, clock-drift warning.
- **Synchronization** (client): encrypted local snapshots, online revisions, read-only offline status.
- **Audit**: redacted security events with opaque identifiers.

Domain code is framework-free TypeScript. Application code depends on ports. Infrastructure implements ports. Next.js route handlers and React components are presentation adapters. Domain modules cannot import Next.js, React, Prisma, Supabase, HTTP, or browser APIs. Server modules cannot import client crypto/decryption or OTP runtime modules. Contexts communicate through public module APIs rather than internal database access.

## Project structure

```text
src/
  app/                         # Next.js presentation and route adapters
  modules/
    identity/
    vault-management/
    vault-membership/
    authenticator-account/
    crypto/
    otp-runtime/
    sync/
    audit/
  shared/                      # minimal framework-neutral shared kernel
  tests/
    unit/ integration/ contract/ browser/ architecture/
prisma/
docs/adr/
```

## Data and API boundaries

Prisma runtime adapters use the pooled `DATABASE_URL`; Prisma CLI migrations and administrative tooling use the direct `DIRECT_URL`. The database retains IDs, ownership/membership role and status, creation/update/deletion timestamps, revisions, opaque encrypted blobs, encryption versions, public keys, Key-Wrap Envelopes, and redacted audit identifiers. It does not retain plaintext vault names, account names/issuers, TOTP configurations, raw URIs, QR images, secrets, OTPs, private keys, Vault Unlock Secrets, Vault Encryption Keys, or User Root Keys.

API contracts validate schemas with Zod. They never accept or return plaintext secrets, generated OTPs, raw QR payloads, plaintext vault keys, or private keys. The MVP uses server-side Prisma for application data access only; Supabase Data API/RLS hardening is explicitly deferred, so no browser or Supabase REST database access may be added before that security work is approved. Authenticated state-changing endpoints (vault/account changes, membership changes, key registration) are rate-limited; Supabase owns authentication-attempt limits. Read paths remain responsive under infrastructure protection.

## Mobile UI reference

Use [`ui-reference/rhasia-mobile/README.md`](ui-reference/rhasia-mobile/README.md) and its 15 numbered screen slices as the visual reference for the mobile experience. Every screen inherits the canonical [`ui-reference/rhasia-mobile/design-system.md`](ui-reference/rhasia-mobile/design-system.md) contract for tokens, layout, components, states, and accessibility. The reference maps each screen to the delivery slices and captures reusable OTP, countdown, Vault-card, role-badge, synchronization-status, and icon specimens.

It is non-authoritative for behavior and terminology: the authoritative requirements remain the Vault Unlock Secret and explicit-lock model, the Owner/Viewer role plus granular account-capability model defined above and in the ADRs, QR/raw URI handling, audit redaction, and offline write blocking.

## Slice 0 — architecture skeleton and quality gates

### Goal

Create the production-shaped foundation before behavior is implemented.

### Deliverables

- Next.js App Router project with strict TypeScript, mise-managed Node.js 24.19.0 and pnpm 11.17.0 as the repository package manager.
- Modular bounded-context directories and public module entry points.
- ESLint, TypeScript, build, Vitest unit/integration/contract configuration, Playwright browser smoke configuration, and dependency-cruiser architecture checks.
- Prisma schema, migration workflow, test-database environment contract, and a repository integration-test seam.
- Supabase server-session adapter port and replaceable fake adapter.
- A route-contract smoke endpoint and a browser smoke page.
- CI workflow that runs lint, typecheck, unit/integration/contract tests, browser smoke, architecture checks, Prisma validation/migration check, and build.
- `AGENTS.md` repository instructions.

### Acceptance evidence

CI and local commands run lint, typecheck, tests, architecture checks, Prisma validation/migration checks, and build. A sample framework-free domain test, repository integration test, route contract test, and browser smoke test pass. Architecture tests prove forbidden imports fail. Supabase session verification is substitutable with a fake. Missing external Supabase/database credentials must produce explicit configuration errors rather than a bypass.

## Slice 1 — passwordless email authentication and application user

A user signs up or signs in by Supabase email OTP/magic link with Confirm email enabled. A verified session provisions or loads an Application User idempotently. No password registration, `allowed_emails` table, or in-app user-management exists. Protected routes verify a server session.

## Slice 2 — default Personal Vault and secure initialization

First login idempotently creates one Uninitialized Personal Vault. The client requires secure-vault setup before account use or usable shared access: it creates the User Root Key and Personal Vault Encryption Key, derives/wraps keys, and registers client crypto. Personal Vaults cannot be deleted.

## Slice 3 — local TOTP runtime

A client-only screen parses standard `otpauth://totp` input and generates codes offline. Supported configurations are SHA-1/SHA-256/SHA-512, 6/8 digits, and a positive period. HOTP, proprietary formats, unsupported algorithms, raw URI persistence, and server OTP requests are rejected. Warn if online server-date drift exceeds 30 seconds.

## Slice 4 — client crypto foundation

Implement versioned encryption envelopes, AES-GCM payload encryption, P-256/HKDF key wrapping, Argon2id derivation, User Root Key hierarchy, Remembered Browser Local Verification, explicit lock/logout clearing, passphrase-change flow (current passphrase + Local Verification), and sensitive-data redaction.

## Slice 5 — encrypted Personal Vault accounts

Client parses/normalizes input, encrypts it, and stores ciphertext. Reload/new enrolled browser access works without server decryption. Account lists decrypt locally and sort by issuer/account name. Duplicates are client-side warnings with cancel/open-existing/add-anyway actions. Copy writes only to the system clipboard on explicit action.

## Slice 6 — QR import

Camera scanning, image upload fallback, and manual URI input remain client-side. Users preview and confirm before saving. No raw QR data reaches the server.

## Slice 7 — Shared Vault creation

Create a named encrypted Shared Vault and owner membership atomically. The owner is the only member-manager and always has every mutation capability. Vault-wide member account permissions start denied.

## Slice 8 — user encryption identity

Create/register public keys; encrypt private key backups under the User Root Key. New browsers recover them only after secure enrollment. Private keys never reach the server in usable form.

## Slice 9 — share links and membership grants

Owners create recipient-bound one-time Secure Share Links for exact email recipients. The link's secret travels through a secure out-of-band channel and is not exposed to the server. After recipient signup/sign-in, enrollment, and redemption, a Viewer Membership Grant with their envelope becomes active. Owner-only UI lists members/invitations; viewers cannot.

## Slice 10 — Shared Vault OTP access

A Viewer unwraps only their Key-Wrap Envelope, decrypts vault name/accounts locally, and copies OTPs. Server responses exclude other members' envelopes and all plaintext. A locked state exposes only generic vault labels.

## Slice 11 — authorized account mutations in Shared Vaults

Owners always add encrypted accounts. Viewers may add accounts only when their effective add permission allows it; that permission resolves from a nullable member override or the Vault-wide default. Viewers receive only ciphertext and independently generate OTPs. Optimistic Account Revision rejects stale writes; authorized writers may reload or save stale content as a new account.

## Slice 12 — revocation and leaving

Owners revoke viewers; viewers may leave. Future online fetches fail immediately; next successful client contact removes local snapshots and remembered material. Explain copied-secret and offline limitations.

## Slice 13 — edits, deletion, and recovery

Owners always update/delete/restore accounts with revisions. Viewers may replace the complete encrypted account payload or soft-delete an account only when the matching effective permission allows it. Account restoration and Shared Vault deletion/restoration remain owner-only; both deletion lifecycles retain their 30-day recovery windows. Personal Vault deletion is forbidden.

## Slice 14 — encrypted offline PWA

Store encrypted Local Vault Snapshots after sync. Allow read-only offline unlock and OTP generation; show offline state and block all writes. Reconnection handles revision/access removal.

## Slice 15 — audit history

Write redacted events for vault creation, invitation/link lifecycle, membership grants/revocation/leave, account changes, restoration, and future rotation. Store no plaintext content or labels. Owners alone see history; retain it for one year after vault deletion.

## Slice 16 — advanced security and recovery

Threat-model and implement recovery, device lifecycle, normal vault-key rotation, user-key rotation, export/import, and passkey-assisted recovery. Before this slice, suspected compromise requires a new vault, original-service 2FA reset/re-add, member re-grants, and deletion of the old vault.

[Encrypted Vault Archive V1 backup/import](encrypted-vault-backup.md) is delivered as a client-cryptographic vertical slice: owners export a browser-created archive with a separate random key; import into an existing Shared Vault is available to a Viewer with effective add permission, while Personal Vault and new Shared Vault ownership rules remain unchanged; import validates and previews locally before an atomic write; and successful exports/imports create redacted owner-only Vault Audit events for Personal and Shared Vaults. Archive bytes, archive keys, Vault Names, account counts, and TOTP content never enter export-audit requests, logs, or TanStack Query. Import requests contain only permitted opaque identifiers, versions, and re-encrypted account ciphertext; the server can observe the imported record count but cannot read archive or TOTP content.

## Delivery order

1. Slice 0 foundation.
2. Personal authenticator MVP: Slices 1–6.
3. Shared Vault MVP: Slices 7–12.
4. Reliability: Slices 13–15.
5. Advanced recovery/security: Slice 16.

Do not begin shared-vault implementation until the personal encrypted flow is tested end-to-end and server-side plaintext exclusion is verified.
