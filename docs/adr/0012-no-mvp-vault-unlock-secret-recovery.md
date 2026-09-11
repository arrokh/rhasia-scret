# No MVP vault unlock-secret recovery

> **Status:** Partially superseded by ADR-0024 and ADR-0025.

Without previously enrolled Passkey-Assisted Recovery, the MVP cannot reset or recover a lost Vault Unlock Secret. Secure-vault setup must clearly warn users and require acknowledgement because a recovery path that silently bypasses encryption would violate the server zero-knowledge boundary. The later passkey-assisted recovery and destructive-reset flows are explicit client ceremonies and do not recover a Vault Unlock Secret from the server.
