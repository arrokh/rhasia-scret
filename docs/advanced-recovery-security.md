# Advanced recovery and security threat model

## Trust boundary

The authorized web or native client alone handles plaintext TOTP secrets, raw QR content, generated OTPs, Vault Encryption Keys, User Root Keys, Vault Unlock Secrets, and private encryption keys. The service persists encrypted ciphertext and authorization/lifecycle metadata only. A recovery mechanism must not weaken this boundary.

## Threats and controls

| Threat                       | Control                                                                                                                                                                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server/database disclosure   | Client-side authenticated encryption; opaque encrypted key packages; redacted audit events.                                                                                                                               |
| Stolen web or native session | Provider session verification, configured Application Admission (verified email in Supabase mode), application-user status checks, bearer/cookie transport boundaries, and re-unlock before access to decrypted material. |
| Lost device                  | Encrypted User Root Key profile can be unlocked only using the User's passphrase; no server-held recovery secret exists.                                                                                                  |
| Compromised member           | Authorization-only revocation blocks future fetches. It cannot revoke already copied secrets or offline ciphertext; reset affected original-service TOTP credentials and re-add them.                                     |
| Stale/conflicting mutations  | Optimistic Account Revision checks reject stale writes.                                                                                                                                                                   |
| Deleted data                 | Encrypted accounts and Shared Vaults are recoverable only during their 30-day soft-delete window.                                                                                                                         |

## Device lifecycle

Remembered-browser verification and encrypted Local Vault Snapshots are client-installation-local. Web sign-out, explicit forget, membership revocation detected on a successful sync, or Shared Vault deletion must remove applicable device-local material; native sign-out and lifecycle cleanup use Keychain/Android Keystore and application-document storage. Offline access is read-only; mutations are blocked and never queued. Native AppState backgrounding also locks and clears the unlocked workspace, but native device authentication is not a recovery mechanism.

## Key rotation and recovery

Normal Vault Encryption Key rotation must create a fresh key client-side, re-encrypt all active account ciphertext and vault name locally, then wrap the replacement key independently for every active member. User-key rotation must create a new user encryption key pair client-side and re-wrap affected Vault Encryption Keys locally. These operations require a complete transactional protocol and independent recovery-device/passkey enrollment UI; they are not safely representable as a server-side fallback.

The current repository includes the client-only protocol and server endpoint/persistence seams for these operations, but the complete browser/native user-facing ceremonies and recovery-device enrollment are not shipped. Track completion in [#186](https://github.com/arrokh/rhasia-scret/issues/186).

Export/import uses an explicitly user-initiated, client-side Encrypted Vault Archive as defined by ADR 0033. Import authenticates, validates, previews, duplicate-checks, and re-encrypts all content in web or native client memory before one atomic ciphertext-only write; unencrypted export/import is prohibited. Passkey-assisted recovery may protect a client-held recovery wrapping key but must never give the service a key capable of decrypting Vault Encryption Keys or user private keys. Native clients do not currently provide Passkey-Assisted Recovery or Remembered Browser PRF equivalence.

## Current compromise playbook

Until the complete rotation and recovery-device flows are delivered, a suspected compromise requires creating a new vault, resetting/re-adding TOTP secrets at original services, granting members again, then deleting the old Shared Vault. This limitation is intentional and must be displayed in product recovery UX.
