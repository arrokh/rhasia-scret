# Authorization-only membership revocation

Removing a member immediately denies all future application access to the Shared Vault and removes its UI visibility, without automatic key rotation. It cannot erase ciphertext, OTPs, or TOTP secrets the member obtained while authorized; owners must reset affected 2FA secrets at their original services for full credential revocation.
