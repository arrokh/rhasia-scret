# Read-only offline PWA access

The application supports PWA offline use through encrypted Local Vault Snapshots. After successful synchronization, users may unlock cached vaults and generate OTPs offline, but all mutations are blocked until connectivity returns; no plaintext cache or offline write queue is retained.
