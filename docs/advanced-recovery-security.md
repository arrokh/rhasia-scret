# Advanced recovery and security threat model

## Trust boundary

The browser alone handles plaintext TOTP secrets, raw QR content, generated OTPs, Vault Encryption Keys, User Root Keys, Vault Unlock Secrets, and private encryption keys. The service persists encrypted ciphertext and authorization/lifecycle metadata only. A recovery mechanism must not weaken this boundary.

## Threats and controls

| Threat | Control |
| --- | --- |
| Server/database disclosure | Client-side authenticated encryption; opaque encrypted key packages; redacted audit events. |
| Stolen browser session | Supabase session verification, invited-only sign-in, application-user status checks, and re-unlock before access to decrypted material. |
| Lost device | Encrypted User Root Key profile can be unlocked only using the User's passphrase; no server-held recovery secret exists. |
| Compromised member | Authorization-only revocation blocks future fetches. It cannot revoke already copied secrets or offline ciphertext; reset affected original-service TOTP credentials and re-add them. |
| Stale/conflicting mutations | Optimistic Account Revision checks reject stale writes. |
| Deleted data | Encrypted accounts and Shared Vaults are recoverable only during their 30-day soft-delete window. |

## Device lifecycle

Remembered-browser verification and encrypted Local Vault Snapshots are device-local. Sign-out, explicit forget, membership revocation detected on a successful sync, or Shared Vault deletion must remove that device-local material. Offline access is read-only; mutations are blocked and never queued.

## Key rotation and recovery

Normal Vault Encryption Key rotation must create a fresh key client-side, re-encrypt all active account ciphertext and vault name locally, then wrap the replacement key independently for every active member. User-key rotation must create a new user encryption key pair client-side and re-wrap affected Vault Encryption Keys locally. These operations require a complete transactional protocol and independent recovery-device/passkey enrollment UI; they are not safely representable as a server-side fallback.

Export/import must use an explicitly user-initiated, client-side encrypted archive. Unencrypted export is prohibited. Passkey-assisted recovery may protect a client-held recovery wrapping key but must never give the service a key capable of decrypting Vault Encryption Keys or user private keys.

## Current compromise playbook

Until the complete rotation, recovery-device, encrypted export/import, and passkey enrollment flows are delivered, a suspected compromise requires creating a new vault, resetting/re-adding TOTP secrets at original services, granting members again, then deleting the old Shared Vault. This limitation is intentional and must be displayed in product recovery UX.
