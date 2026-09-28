# Advanced recovery and security threat model

## Trust boundary

The authorized web client alone handles plaintext TOTP secrets, raw QR content, generated OTPs, Vault Encryption Keys, User Root Keys, Vault Unlock Secrets, and private encryption keys. The service persists encrypted ciphertext and authorization/lifecycle metadata only. A recovery mechanism must not weaken this boundary.

## Threats and controls

| Threat                              | Control                                                                                                                                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Server/database disclosure          | Client-side authenticated encryption; opaque encrypted key packages; redacted audit events.                                                                                                      |
| Stolen web or installed-PWA session | Passwordless session verification, verified-email Application Admission, application-user status checks, browser assertion/cookie boundaries, and re-unlock before access to decrypted material. |
| Lost device                         | Encrypted User Root Key profile can be unlocked only using the User's passphrase; no server-held recovery secret exists.                                                                         |
| Compromised member                  | Authorization-only revocation blocks future fetches. It cannot revoke already copied secrets or offline ciphertext; reset affected original-service TOTP credentials and re-add them.            |
| Stale/conflicting mutations         | Optimistic Account Revision checks reject stale writes.                                                                                                                                          |
| Deleted data                        | Encrypted accounts and Shared Vaults are recoverable only during their 30-day soft-delete window.                                                                                                |

## Device lifecycle

Remembered-browser verification and encrypted Local Vault Snapshots are browser-profile-local. A hosted snapshot contains Personal Vault data only; Shared Vaults are online-only and are not retained in offline storage. Sign-out, explicit forget, membership revocation detected on a successful sync, or Shared Vault deletion must remove applicable browser-local material. Legacy Shared-containing snapshots are rejected and cleared without touching the independent writable Local Vault. Offline access is read-only; mutations are blocked and never queued. Authorization revocation cannot erase TOTP secrets already learned; reset credentials at the original service after suspected exposure.

## Key rotation and recovery

The web client implements two manually initiated browser ceremonies: Vault Encryption Key rotation creates a fresh key locally, re-encrypts the Vault Name and all retained Authenticator Accounts, and wraps the replacement key independently for every active member; User Encryption Key Pair rotation creates a new client-side ECDH identity and re-wraps every active Shared Vault membership. The server atomically persists only encrypted material and permitted lifecycle metadata. Successful Vault rotation invalidates pending Secure Share Links because their packages contain the old key. Ambiguous outcomes must be reconciled against fresh server state before retrying. The responsive web/PWA is the only supported presentation for these workflows.

Rotation does not revoke secrets, ciphertext, or TOTP credentials already copied by an authorized member or device. For suspected TOTP-secret exposure, reset the affected credential at its original service regardless of rotation. The browser workflows do not introduce scheduled rotation or a server-side recovery fallback. Recovery-device/passkey enrollment remains a separate client-only capability; it must never give the service a key that can decrypt Vault Encryption Keys or user private keys.

Export/import uses an explicitly user-initiated, client-side Encrypted Vault Archive as defined by ADR 0033. Import authenticates, validates, previews, duplicate-checks, and re-encrypts all content in browser memory before one atomic ciphertext-only write; unencrypted export/import is prohibited. Passkey-assisted recovery may protect a client-held recovery wrapping key but must never give the service a key capable of decrypting Vault Encryption Keys or user private keys. Passkey-Assisted Recovery and Remembered Browser are browser-only capabilities.

## Current compromise playbook

Until the complete rotation and recovery-device flows are delivered, a suspected compromise requires creating a new vault, resetting/re-adding TOTP secrets at original services, granting members again, then deleting the old Shared Vault. This limitation is intentional and must be displayed in product recovery UX.
