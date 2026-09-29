# Encrypted Vault Archive export and import

An **Encrypted Vault Archive** is a portable, client-encrypted snapshot. The browser prepares and opens it; the server never receives archive bytes or the separate archive key.

## What an archive contains

Version 1 archives contain one Vault Name and up to 500 active normalized TOTP account configurations, within a 5 MiB size limit. They do not contain members, invitations, audit history, deleted accounts, account revisions, generated OTPs, user keys, or recovery material. Unsupported versions and invalid or oversized content fail before mutation.

The authorized client creates, decrypts, validates, previews, and duplicate-checks the archive in memory. For hosted exports, the server receives only an opaque Vault identifier to authorize and record the export. It never receives the archive, archive key, Vault Name, account count, account labels, TOTP configuration, or secrets.

## Keep two separate items

An export produces:

1. a `.rhasia-vault` encrypted archive; and
2. a separate 32-byte archive key shown as Base64.

Both are required for import. Losing either makes restoration impossible. Store them in separate secure locations; keeping them together weakens the archive's protection. Archives are snapshots and do not update automatically, so create a new one after important changes.

## Export permissions

- A Local Vault can be exported from its browser without hosted authentication or server audit.
- Hosted Personal and Shared Vault exports are owner-only and require an online authenticated session. A successful export is recorded as a redacted owner-visible Vault Audit event before the archive and key are released to the browser.
- Shared Vault members cannot export the Shared Vault archive, regardless of account-add permission.

## Import behavior

Import opens, authenticates, validates, previews, and duplicate-checks the archive locally. It adds accounts; it does not overwrite existing accounts. Duplicate accounts require an explicit cancel-or-add-anyway choice.

Available destinations:

- A Local Vault in the browser.
- An existing hosted Personal Vault owned by the importing user.
- An existing Shared Vault where the importing user is its owner or has effective `canAddAccounts` permission. This includes members granted add permission by either the Vault-wide default or their per-member override.
- A new Shared Vault created by the importing user as its owner.

All imported accounts are re-encrypted for the destination. Hosted imports are atomic: authorization and mutation are checked together, and a failed import stores neither accounts nor a success event. Retrying an already completed import does not duplicate accounts or audit events. Successful hosted imports are recorded as redacted Vault Audit events visible to the owner; Local Vault operations remain browser-only and have no server audit event.

For permission semantics, see [Shared Vault member account permissions](shared-vault-member-account-permissions-plan.md) and [ADR-0047](adr/0047-granular-shared-vault-account-permissions.md).
