# Read-only offline PWA access

The web application supports PWA offline use through encrypted Local Vault Snapshots. The native client reuses the same read-only snapshot contract with its separate context-authenticated native storage layer described by ADR-0042. After successful synchronization, users may unlock cached vaults and generate OTPs offline, but all mutations are blocked until connectivity returns; no plaintext cache or offline write queue is retained.
