# Vault-wide member account permissions with per-member fallback

## Status

Accepted

## Context

A Shared Vault owner needs to delegate Authenticator Account creation, editing, and deletion without delegating membership, audit, key, Vault lifecycle, or recovery administration. A single additional editor role would not express independent capabilities or a Vault-wide baseline. The honest-but-curious server cannot inspect encrypted account content, so it cannot distinguish a label-only edit from replacement of the complete encrypted TOTP configuration.

Member-written ciphertext also increases integrity and availability risk: a permitted member can replace valid ciphertext with malformed or semantically invalid encrypted content. Account Revision prevents stale writes but does not constrain an authorized writer or retain prior ciphertext.

## Decision

Every Shared Vault stores three server-visible Vault-wide member defaults: permission to add, edit, and delete Authenticator Accounts. New and migrated Vaults default all three to denied. Every non-owner Membership Grant stores an independent nullable override for each capability. A null override inherits the corresponding Vault default; explicit `true` allows and explicit `false` denies. Changing one Vault default affects only members inheriting that capability.

The Vault Owner always has all account capabilities regardless of stored defaults or overrides. This delegation does not introduce an Editor role. New and reactivated memberships have all overrides unset. Revocation, leaving, and later reactivation clear old overrides so personal privileges cannot return unexpectedly.

Add permission covers direct account creation and Encrypted Vault Archive import into an existing Shared Vault. Edit permission authorizes replacement of the complete encrypted account payload. Delete permission performs the existing 30-day soft deletion; only the owner may restore an account. Rename, Vault deletion/restoration, export, invitation, membership, permission administration, audit history, key rotation, and other owner responsibilities remain owner-only.

The server resolves effective permissions and performs authorization plus mutation atomically against an active Membership Grant and active Shared Vault. Client affordances are not an authorization boundary. Account edits and deletions retain optimistic Account Revision checks. Permission settings have separate revisions so stale owner sessions cannot overwrite newer policy.

Successful Shared Vault account and permission changes write actor-attributed, redacted Vault Audit events in the same transaction. Events contain only permitted authorization/lifecycle metadata and opaque identifiers, never Vault Names, account labels, TOTP configuration, generated OTPs, ciphertext contents, or keys.

Effective permissions and their per-capability source may be returned to the affected member and included in Local Vault Snapshots as permitted authorization metadata. Other members' settings and the member list remain owner-only. Offline and stale workspaces remain read-only regardless of cached permissions.

Clients isolate malformed Authenticator Account records so one invalid member-written payload cannot make every account in the Shared Vault unavailable. The owner receives an opaque integrity warning and can soft-delete the bad record without exposing its encrypted content.

## Consequences

Owners can establish one baseline and override only exceptional capabilities for individual members. Explicit deny remains distinguishable from inheritance. Permission changes take effect on the server immediately, although an already-open client can display stale controls until its next denied request and refresh.

Granting edit authority grants integrity authority over the entire TOTP configuration, and no previous encrypted revision is recoverable after a successful edit. Granting delete authority temporarily removes an account for every member, but owner-only recovery remains available for 30 days. Membership revocation still cannot erase secrets previously learned by a member.

This decision amends the owner-only account mutation authorization in ADR-0014 and the owner-only existing-Shared-Vault import destination in ADR-0033; their retention, atomicity, encryption, and archive-format decisions remain unchanged.
