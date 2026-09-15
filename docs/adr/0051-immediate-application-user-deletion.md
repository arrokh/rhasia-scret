# ADR-0051: Immediate web Application User deletion

- Status: Accepted
- Date: 2026-09-15

## Context

A hosted Application User must be able to permanently leave the service without confusing account deletion with an Authenticator Account reset or deletion of the independent Local Profile and Local Vault. The server is honest-but-curious, so Vault Names, TOTP configuration, archive keys, and decrypted content must remain client-only. OIDC sessions are stateless and passwordless links may exist outside the current browser, so deleting database sessions alone is insufficient.

The product also supports owned Shared Vaults. Deleting an owner without resolving ownership would either strand encrypted content or silently transfer authority. The existing Shared Vault retention policy is designed for ordinary Vault deletion, not an explicitly authenticated account-deletion request.

## Decision

The web account-deletion workflow performs one synchronous, transactional hard deletion of the hosted Application User. It requires same-origin browser requests, a fresh passwordless deletion OTP or OIDC `prompt=login`/`max_age=0` reauthentication, a one-time deletion authorization, the exact confirmation phrase `HAPUS AKUN`, and an explicit acknowledgement.

Before submission, the browser may export the Personal Vault and every owned Shared Vault as separate existing-format Encrypted Vault Archives. Each archive contains only its Vault Name and TOTP configuration while opened in authorized client memory. The browser downloads the archive and separate archive key; no archive bytes, keys, names, or TOTP data enter the server, email, logs, analytics, or persistence. A selected export failure blocks deletion.

Each owned Shared Vault must be explicitly selected for permanent hard deletion or transfer to an existing active Viewer with usable current encrypted-key access. Transfer promotes that Viewer to owner, removes the deleting user completely, and preserves the surviving Vault and its pending invitations. A deleted Vault and all of its accounts, invitations, memberships, and audit events are removed immediately. Invitations addressed to the deleting user and all Viewer memberships elsewhere are hard-deleted. No Vault Audit History involving the deleted user is preserved.

The transaction deletes user-owned Vault data, memberships, invitations, crypto and recovery material, identities, sessions, security events, and rate-limit records before deleting `ApplicationUser`. It records a non-foreign-key `AccountDeletionRecord` and identity tombstones containing only the approved deletion receipt metadata. The tombstones reject OIDC credentials issued at or before deletion and passwordless challenges created at or before deletion, while allowing a fresh registration with the same identity immediately afterward. A hashed one-time authorization remains associated with the receipt until its 10-minute expiry so a lost-response retry is idempotent; the regular retention purge then removes the expired challenge.

Completion email delivery is best-effort and contains only the opaque receipt ID. A non-user-linked aggregate deletion metric is stored separately; no identified browser analytics event is emitted and analytics identity is not reset. Application-controlled records are deleted according to this decision, while external email-provider, hosting, and backup retention remains subject to those providers' operational policies and is documented as a limitation.

## Consequences

Account deletion is not recoverable and is an explicit exception to ADR-0013's ordinary 30-day Shared Vault retention. The deletion route is browser-only; native clients receive no UI or client workflow. Browser cleanup clears the current hosted workspace, offline snapshots, Remembered Browser packages, and authentication cookies, but never clears the Local Profile or Local Vault. The completion page remains public and offers sign-in and the public landing page.

The retained ledger is a deliberate privacy and security exception: it contains limited identity metadata but no encrypted Vault content or cryptographic material. Any future change to ledger retention, third-party deletion guarantees, transfer eligibility, or native account deletion requires a new ADR or amendment.
