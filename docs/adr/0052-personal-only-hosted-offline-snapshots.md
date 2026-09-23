# Personal-only hosted offline snapshots

## Decision

Hosted Local Vault Snapshots contain only the authenticated user's encrypted Personal Vault. Shared Vaults remain online-only. The writable browser Local Vault is independent and is not changed by this policy.

Online unlock and refresh use the versioned `GET /v1/sync/workspace-bundle` response. It is authenticated, `no-store`, and contains a Personal-only snapshot projection plus currently authorized Shared Vault material for transient in-memory use. Browser and native snapshot stores accept only the Personal-only v3 contract and never receive the full online response.

Legacy snapshots that may contain Shared Vault data are rejected and removed before offline presentation. Browser discovery reports migration-required state; native encrypted storage clears the hosted snapshot blob and secure storage key. Neither migration path touches the independent writable Local Vault.

Network loss and failed non-authentication refreshes evict transient Shared Vault keys, accounts, and state before stale/offline presentation. A global authentication failure clears the unlocked hosted workspace while retaining the encrypted Personal-only snapshot for an explicit offline unlock. Successful refresh persists only the Personal projection and restores Shared Vaults only when currently authorized.

## Consequences

- Personal Vault OTP generation remains available read-only offline.
- Shared Vault convenience is lost offline, but a disconnected client cannot use a supported Personal-only snapshot to open a Shared Vault after revocation.
- Existing clients may retain old Shared-containing snapshots until they reconnect and update; the legacy route remains during rollout and is a security rollback path.
- Revocation cannot erase secrets or OTPs already learned by a member, copied outside application storage, or retained by an old permanently offline client. Original-service TOTP credentials require reset after suspected exposure.
- No database migration is required; migration is client-storage-only and destructive for legacy hosted snapshots.

## Verification

The v3 parser rejects Shared-containing snapshots, online route contract tests prove transient Shared data and Personal-only projection separation, browser IndexedDB and native encrypted-store tests cover cleanup, and workspace lifecycle tests cover Shared eviction on connectivity loss.
