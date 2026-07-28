# Encrypted Vault backup and import

An owner can create an **Encrypted Vault Archive** for a Personal Vault or an owned Shared Vault. Viewers cannot export archives.

## What a backup contains

Archive ciphertext contains the Vault Name and active normalized TOTP configurations. It does not contain members, invitations, audit history, deleted accounts, account revisions, generated OTPs, the User Root Key, the User Encryption Key Pair, or recovery material.

Archive creation and opening happen in browser memory. The server receives only the opaque Vault identifier needed to authorize and audit an export. It never receives the archive, archive key, Vault Name, account count, account labels, TOTP configuration, or secrets.

## Keep two separate items

A backup produces:

1. a `.rhasia-vault` encrypted archive; and
2. a separate 32-byte archive key shown as Base64.

Both are required for import. Losing either makes restoration impossible. Store them in separate secure locations; keeping them together weakens the archive's protection. Backups are snapshots and do not update automatically, so create a new backup after important changes.

## Import behavior

Import opens, authenticates, validates, previews, and duplicate-checks the archive locally. The owner selects an existing owned Personal or Shared Vault, or creates a new Shared Vault. All imported accounts are re-encrypted for the destination and stored atomically. Import adds accounts; it does not overwrite existing accounts. Duplicate accounts require explicit confirmation.

Successful exports and imports appear in owner-only Vault Audit History as redacted events. A failed export audit does not release the prepared archive or key. A failed import stores neither accounts nor a success event, and replaying the same completed import does not duplicate accounts or audit events.
