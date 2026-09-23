# Read-only offline PWA access

The web application supports PWA offline use through encrypted, read-only **Local Vault Snapshots** containing only the server-backed Personal Vault. Shared Vaults are online-only and are never persisted or unlocked through an offline snapshot. The native client reuses the Personal-only snapshot contract with its separate context-authenticated native storage layer described by ADR-0042.

After successful online synchronization, users may unlock the Personal Vault snapshot and generate OTPs offline, but all mutations are blocked until connectivity returns; no plaintext cache or offline write queue is retained. Online Shared Vault access uses the separate authenticated, `no-store` workspace response and remains transient in client memory.

Legacy snapshots that may contain Shared Vault data are rejected and cleared before offline presentation. On network loss or failed refresh, transient Shared Vault material is evicted before stale/offline presentation; a global authentication failure clears the active hosted workspace while retaining the encrypted Personal-only snapshot for explicit offline unlock. Revocation cannot erase secrets already learned by an authorized member.
