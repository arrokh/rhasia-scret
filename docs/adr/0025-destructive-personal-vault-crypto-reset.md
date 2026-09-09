# Destructive Personal Vault crypto reset without recovery

This decision supersedes the reset prohibition in ADR-0012 and ADR-0001 only for an explicitly destructive restart; their prohibition on recovering or bypassing the lost secret remains in force.

An authenticated user who has lost their Vault Unlock Secret and did not previously enroll Passkey-Assisted Recovery may explicitly destroy their unusable cryptographic profile and restart secure Personal Vault setup. This is data destruction, not recovery: the operation cannot decrypt or preserve ciphertext protected by the old User Root Key.

The operation requires the exact Indonesian confirmation phrase `HAPUS DATA BRANKAS`, is unavailable while Passkey-Assisted Recovery exists, and is blocked while the user owns any active Shared Vault. Before retrying, an owner must resolve those Shared Vaults through their existing lifecycle procedures. A reset hard-deletes every Authenticator Account in the user's Personal Vault, deletes the User Crypto Profile and pending passkey challenges, clears the Personal Vault's encrypted name, and returns that non-deletable Vault to `UNINITIALIZED`.

The reset also marks every active Shared Vault Viewer membership as `LEFT`, removes its obsolete encrypted Vault Encryption Key envelope, and deletes pending invitations addressed to the resetting user. Existing Shared Vault ciphertext and other users' access remain unchanged. After the user establishes new cryptographic material, a new Secure Share Link may reactivate the retained Viewer membership with a replacement envelope. Browser-local remembered credentials and encrypted snapshots in the current browser are removed after a successful reset; material already obtained by another browser cannot be remotely erased.

This narrowly defined operation is an explicit exception to normal 30-day soft deletion because retaining ciphertext cannot make it recoverable after destruction of the only key path. Product copy must state that original services' 2FA credentials need to be reset and re-added, and the server must never claim that encrypted vault data was recovered.
