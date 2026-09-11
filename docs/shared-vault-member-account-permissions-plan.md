# Shared Vault member account permissions plan

## Status

Accepted for implementation. Permission resolution uses **Vault-wide member defaults** with an independent nullable per-member override for each account capability.

## Goal

Let a Shared Vault owner delegate account creation, editing, and deletion independently to a member while preserving these invariants:

- the Vault Owner always has every account capability and remains the only person who manages membership, permissions, Vault lifecycle, Vault Name, audit history, key rotation, and account restoration;
- a new or re-invited member inherits every Vault-wide member default until the owner overrides individual capabilities for that member;
- authorization is enforced by the server at mutation time; client controls are only guidance;
- plaintext Vault Names, account data, TOTP configuration/secrets, OTPs, and cryptographic keys remain client-only;
- offline access remains read-only and never queues mutations;
- Account Revision still rejects stale edits and deletions;
- deletion remains a 30-day soft deletion.

Do not add an `EDITOR` role. Keep `OWNER` and `VIEWER` as the membership roles, but present non-owners as members and model account-management authority as independent capabilities.

## Recommended behavior

### Permission model

Use related permission shapes for Vault defaults and nullable member overrides:

```ts
type SharedVaultAccountPermissions = {
  canAddAccounts: boolean;
  canEditAccounts: boolean;
  canDeleteAccounts: boolean;
};

type MemberAccountPermissionOverrides = {
  canAddAccounts: boolean | null;
  canEditAccounts: boolean | null;
  canDeleteAccounts: boolean | null;
};
```

Persist non-null Vault-wide defaults on `Vault`. Persist one nullable override per capability on each `VaultMember`; `null` means “inherit the corresponding Vault default.” Add revisions for optimistic concurrency when the owner changes either level.

Rules:

1. Owner effective permissions are always all `true`; Vault defaults and member overrides never constrain the owner.
2. Resolve each non-owner capability independently: `memberOverride.capability ?? vaultDefaults.capability`.
3. A member may override add, edit, or delete without overriding the other capabilities. There is no single inheritance/override mode for the member.
4. New Shared Vaults start with all Vault-wide member defaults `false`. Existing Vaults migrate to the same deny-by-default baseline.
5. New memberships and reactivated memberships have all three overrides `null` and therefore inherit the current Vault defaults for every capability.
6. Revocation and leaving clear all three member overrides and increment `permissionsRevision`; invitation redemption must do the same on a reactivated row. This prevents old personal privileges from returning after re-invitation while still applying current Vault policy.
7. Changing a Vault default immediately changes that capability for members whose corresponding override is `null`; an explicit `true` or `false` override remains unchanged.
8. A capability applies to any active Authenticator Account in the Vault, not only accounts created by that member.
9. `canEditAccounts` authorizes replacing the complete encrypted account payload. The honest-but-curious server cannot prove that ciphertext changed only a label, so the UI must not describe this as label-only authority.
10. `canDeleteAccounts` authorizes only soft deletion. Restore and permanent lifecycle administration remain owner-only.
11. `canAddAccounts` covers every way of adding accounts to an existing Shared Vault, including single-account creation and Encrypted Vault Archive import. Export and creation/import of a new Shared Vault remain owner-only.
12. Permission metadata may be returned to the affected member and persisted in the encrypted Local Vault Snapshot because it is permitted authorization metadata. A member must never receive other members' settings or the member list.

### Authorization matrix

| Operation                                             | Owner  | Member                                                            |
| ----------------------------------------------------- | ------ | ----------------------------------------------------------------- |
| Read/decrypt/generate/copy OTP                        | Always | Always while membership is active                                 |
| Add one account                                       | Always | Effective `canAddAccounts` from member override or Vault defaults |
| Import accounts into this existing Shared Vault       | Always | Effective `canAddAccounts`                                        |
| Edit/replace an active account payload                | Always | Effective `canEditAccounts`                                       |
| Soft-delete an active account                         | Always | Effective `canDeleteAccounts`                                     |
| Restore a deleted account                             | Always | Never                                                             |
| Rename/delete/restore/export the Vault                | Always | Never                                                             |
| Invite/revoke/list members                            | Always | Never                                                             |
| View/change member permissions                        | Always | Never                                                             |
| View Vault Audit History                              | Always | Never                                                             |
| Perform any mutation offline or from a stale snapshot | Never  | Never                                                             |

## Baseline implementation gaps addressed

Before this implementation, the role gate was duplicated across the stack:

- `prisma/schema.prisma` has neither Vault-wide member defaults nor per-member overrides;
- `src/modules/authenticator-account/infrastructure/prisma-shared-owner-account-repository.ts` authorizes only `Vault.ownerId`;
- `src/app/api/shared-vaults/[vaultId]/accounts/route.ts` maps every authorization failure to `owner_access_required`;
- Shared Vault access and the Local Vault Snapshot return only `role`;
- account creation, account management, Shared Vault management, and archive import make controls available only when `role === "OWNER"`;
- account restoration and existing-Shared-Vault archive import are owner-only;
- active participants returned to the owner contain no permission metadata;
- the strict Local Vault Snapshot schema is version 1 and rejects added fields;
- account mutation audit events are not currently written by the Shared Vault account repository.

This implementation replaces those scattered account-mutation role checks with one domain capability model while retaining owner-only checks for non-account administration.

## Implementation plan

### 1. Resolve domain language and record the security decision

1. Add an ADR, for example `docs/adr/0047-granular-shared-vault-account-permissions.md`, covering:
   - Vault-wide defaults with independent per-capability member overrides rather than an `EDITOR` role;
   - field-by-field fallback semantics, deny-by-default migration, and owner bypass;
   - server-visible permission metadata;
   - full-payload meaning of edit permission;
   - member deletion as soft deletion with owner-only restoration;
   - archive import as an account-addition path;
   - authorization and mutation in one database transaction;
   - immediate server enforcement and the limitations of stale UI/offline copies;
   - redacted, actor-attributed audit events.
2. Update `CONTEXT.md` immediately after the terminology is accepted:
   - define **Shared Vault Account Permissions**, **Vault-wide Member Permissions**, and **Member Permission Override**;
   - revise **Vault Owner** and **Vault Viewer** so a Viewer receives effective account capabilities from Vault defaults or a personal override;
   - state that this delegation is not a new role;
   - state that edit authority includes the entire encrypted TOTP configuration;
   - state that member deletion does not include restore.
3. Mark the authorization sentence in ADR-0014 as amended by the new ADR while retaining its 30-day retention decision.
4. Amend ADR-0033 because an existing Shared Vault archive destination will no longer always require ownership.
5. Update the authoritative behavior in `docs/mvp-plan.md` and the affected UI references (`README.md`, screens 05, 09, 10, 11, and 14, plus the design-system footer). Remove statements that every Viewer is unconditionally mutation-free, but retain owner-only membership and audit access.

### 2. Add the domain policy and database fields

1. Add `src/modules/vault-membership/domain/shared-vault-account-permissions.ts` with:
   - the three-capability type and nullable per-capability override type;
   - `NO_ACCOUNT_PERMISSIONS` and `ALL_ACCOUNT_PERMISSIONS`;
   - an operation union such as `ADD | EDIT | DELETE`;
   - a pure resolver such as `effectiveSharedVaultAccountPermissions(role, vaultDefaults, memberOverrides)` that falls back field-by-field;
   - a pure capability check against the resolved permissions;
   - validation/copy helpers that preserve explicit `false` separately from inherited `null`.
2. Export the policy through `src/modules/vault-membership/index.ts`; other bounded contexts must use this public API rather than membership internals.
3. Add non-null Vault-wide defaults to `Vault` in `prisma/schema.prisma`:
   - `membersCanAddAccounts Boolean @default(false)`;
   - `membersCanEditAccounts Boolean @default(false)`;
   - `membersCanDeleteAccounts Boolean @default(false)`;
   - `memberPermissionsRevision Int @default(1)`.
4. Add nullable override fields to `VaultMember`:
   - `canAddAccountsOverride Boolean?`;
   - `canEditAccountsOverride Boolean?`;
   - `canDeleteAccountsOverride Boolean?`;
   - `permissionsRevision Int @default(1)`.
     Mixed null/non-null values are valid and express independent fallback. Never collapse explicit `false` into `null`.
5. Generate the migration only through Prisma CLI (`pnpm prisma migrate dev --name add_shared_vault_account_permissions`). Do not hand-author SQL. Non-null Vault defaults migrate existing Vaults to read-only member behavior; null member overrides make existing members inherit that baseline. Owner access remains preserved through the domain bypass.
6. Do not add a permission index; authorization reads already use the `(vaultId, userId)` primary key.

### 3. Add owner-only permission administration

1. Extend owner-visible Shared Vault details with Vault defaults and their revision. Extend `VaultParticipant` so active member rows include all three nullable overrides, all three effective permissions, and `permissionsRevision`; pending invitations have no overrides.
2. Add application use cases and repository ports under `src/modules/vault-membership/application/` for:
   - replacing the complete Vault-wide default profile using `expectedMemberPermissionsRevision`;
   - replacing a member's complete three-field override state (`boolean | null` per field) using `expectedPermissionsRevision`.
3. Implement Prisma adapters that authorize only the active Shared Vault owner, update revisions atomically, and return distinct updated/stale/unavailable outcomes.
4. Add an owner-only endpoint such as `PATCH /api/shared-vaults/[vaultId]/member-permissions` for Vault defaults.
5. Extend `PATCH /api/shared-vaults/[vaultId]/members/[userId]` beside the existing `DELETE` handler for member override changes. Require all three keys in a strict payload, with each value either boolean or null. Sending the complete state avoids accidental merge semantics while still allowing independent fallback.
6. Authenticate and apply the `membership_mutation` rate limit before parsing both payloads; update the mutation inventory test.
7. Update revoke, leave, and invitation redemption to clear overrides and increment the member revision whenever an old membership row is deactivated or reactivated.
8. Record redacted `VAULT_MEMBER_DEFAULT_PERMISSIONS_UPDATED` and `MEMBER_PERMISSIONS_UPDATED` audit events containing only opaque Vault/actor/member identifiers. Never store permission request bodies in audit history.

### 4. Replace the owner-only Shared Vault account mutation adapter

1. Introduce an application-facing Shared Vault account repository/use case in the Authenticator Account context and rename `PrismaSharedOwnerAccountRepository` to `PrismaSharedAccountRepository`.
2. Pass `actorUserId`, not `ownerId`, into create/update/delete/restore operations.
3. For `POST`, `PATCH`, and `DELETE`, authorize and mutate in one transaction against:
   - active Application User session (route layer);
   - active Shared Vault lifecycle;
   - active membership for the same actor and Vault;
   - effective permissions resolved from owner bypass, member override, or Vault-wide defaults;
   - the exact capability required by the operation;
   - active account ownership by that Vault for edit/delete;
   - expected Account Revision for edit/delete.
4. Lock or condition the membership row during the mutation so a committed permission revocation prevents later writes. Permission updates/revocations and account mutations must use a consistent lock order.
5. Keep `PUT` restore owner-only. Do not interpret delete permission as recovery administration.
6. Return typed outcomes instead of matching exception strings:
   - `404 shared_vault_unavailable` for no active membership/Vault;
   - `403 account_permission_required` for an active member missing the capability;
   - `409 stale_revision` for an account revision conflict;
   - `404 account_unavailable` for owner-only restore misses.
7. Keep existing payload bounds, encryption-version validation, and `account_mutation` rate limiting.
8. Write redacted audit events in the same transaction as successful Shared Vault changes:
   - existing `ACCOUNT_ADDED` for create;
   - new `ACCOUNT_UPDATED`;
   - new `ACCOUNT_DELETED`;
   - new `ACCOUNT_RESTORED` for owner restore.
     Each event stores only Vault ID, owner ID, actor user ID, event type, opaque account ID, and timestamp. Failed/stale/unauthorized operations write no event.

### 5. Apply add permission to encrypted archive import

1. Change the archive import application/repository actor parameter from owner to authenticated actor.
2. For an existing Personal Vault, continue to require ownership.
3. For an existing Shared Vault, lock and authorize an active owner membership or a member whose resolved effective permissions include `canAddAccounts` in the same import transaction.
4. For `NEW_SHARED`, continue to require the actor to become the owner.
5. Store the actual Shared Vault owner ID and member actor ID in the `ARCHIVE_IMPORTED` event.
6. Re-authorize idempotent replay reads; a retry after permission revocation must not reveal or claim success without current access.
7. Include Shared Vaults with effective add capability in the archive import destination picker. Export remains owner-only.

### 6. Carry effective permissions through online access and offline snapshots

1. Add effective `accountPermissions` to:
   - `SharedVaultAccess`;
   - `PrismaSharedVaultAccessRepository` results;
   - `GET /api/shared-vaults` and `GET /api/shared-vaults/[vaultId]` contracts;
   - the Shared Vault entry in the offline synchronization bundle;
   - `UnlockedVault` and `SharedVaultSummary`.
2. Synthesize all-true permissions for owners. For Viewers, resolve and return effective permissions plus the inheritance/override source of each capability; never return another member's overrides.
3. Introduce Local Vault Snapshot schema version 2. Keep a strict parser for both known versions:
   - v2 requires `accountPermissions` on each Shared Vault;
   - v1 is normalized in memory to all-true for owners and all-false for Viewers;
   - unknown versions still fail closed.
     This preserves existing read-only offline snapshots without trusting an old Viewer snapshot for writes.
4. No IndexedDB store migration is required because the key/store shape is unchanged; a later successful online synchronization replaces v1 with v2.
5. Keep all offline and stale workspaces mutation-disabled regardless of stored permissions.

### 7. Update client permission management and account affordances

1. Add a Vault Membership infrastructure client and TanStack Query mutation hook for updating permissions. Invalidate the context-prefixed participant query after success.
2. Add an owner-only TanStack Form for the Vault-wide member defaults. In the member list, add a separate permission dialog/sheet where add, edit, and delete each have three choices: “Use Vault default,” “Allow,” or “Deny.” Show each capability's inherited/overridden source and a human-readable effective summary; never expose raw enum or column names.
3. Explain the integrity impact:
   - edit can replace the account's complete TOTP configuration;
   - delete removes it for everyone and only the owner can restore it;
   - add includes archive import into this Vault.
4. Split `VaultAccountManagementList.editable` into `canAddAccounts` and `canDeleteAccounts`.
5. Let `AuthenticatorAccountCreator` list/select a Shared Vault when its effective add permission is true. Recheck the capability before encrypting and sending.
6. Split `AuthenticatorAccountManagerDialog` into independent `canEdit` and `canDelete` affordances. `PersonalVaultAccounts` should expose management when either is true, but render only allowed actions.
7. Update Shared Vault detail banners and directory badges to describe effective capabilities rather than saying every Viewer is read-only.
8. On `account_permission_required`, tell the user their permissions changed, close/disable stale controls, and directly refresh the unlocked workspace. Do not place the User Root Key, Vault Encryption Key, decrypted account, or TOTP secret in TanStack Query state while refreshing.
9. Keep rename, invitation, participants, audit, Vault lifecycle, export, and rotation controls owner-only.

### 8. Harden integrity now that non-owners can write ciphertext

An authorized member has the Vault Encryption Key and can deliberately or accidentally upload ciphertext that the server cannot semantically validate. Before granting write access broadly:

1. Continue strict server-side envelope length/version validation without attempting decryption.
2. Decrypt Shared Vault accounts independently so one malformed account does not make every account in that Vault unavailable.
3. Represent an undecryptable record by opaque account ID only and let the owner delete it; never log or send decrypted failure data.
4. Show the owner an integrity warning and rely on the transactional mutation audit event to identify the actor.
5. Document that edit delegation grants integrity authority: there is no prior-revision recovery for an overwritten encrypted payload. Account Revision prevents stale writes, not malicious authorized writes.

If malformed-record isolation is intentionally deferred, call that out as an accepted availability risk in the ADR rather than silently widening the writer set.

## Test plan

### Unit tests

- exhaustive permission resolution matrix for owner, all eight Vault-default combinations, and all 27 nullable member-override combinations;
- deny-by-default plus preservation of explicit `false` versus inherited `null`;
- owner bypass regardless of stored flags;
- component affordances for add-only, edit-only, delete-only, mixed, owner, stale, and offline workspaces;
- permission form validation, pending states, errors, and accessible control associations;
- v1 Local Vault Snapshot normalization and strict v2 parsing;
- malformed account isolation;
- updated mutation-rate-limit inventory.

### Contract/route tests

- owner responses expose Vault defaults plus each active member's nullable overrides and effective permissions; member responses expose only that member's effective permissions and per-capability source;
- Vault-default and member-override PATCH auth, validation, rate limit, success, stale revision, and unavailable responses;
- Shared Vault account POST/PATCH/DELETE map unavailable membership, missing capability, stale Account Revision, and success distinctly;
- PUT restore remains owner-only even when a member can delete;
- Shared Vault list/detail and offline bundle return only the current actor's effective permissions;
- no response or audit body contains Vault/account plaintext, keys, TOTP material, or OTPs.

### Prisma integration tests

- existing Vaults migrate to all-false defaults and existing members inherit them;
- new/re-invited members inherit current Vault defaults with no personal override;
- revoke, leave, and reactivation cannot resurrect old overrides;
- changing one Vault default affects only members inheriting that capability, including members overriding either of the other capabilities;
- owner can always create/edit/delete/restore;
- each member capability allows exactly one operation and denies the other two;
- edit/delete enforce account Vault ownership and Account Revision;
- revoked/inactive member and deleted Vault writes fail;
- permission-revision conflicts do not overwrite newer settings;
- permission revocation racing a mutation has a deterministic transaction boundary;
- successful mutations and permission changes write one redacted audit event atomically; failures write none;
- archive import allows add-capable Shared Vault members, still denies other members, and remains atomic/idempotent;
- v2 offline bundle returns effective current-member permissions only.

### Browser acceptance tests

1. Owner sets Vault defaults to add-only and invites a member; the redeemed membership inherits add-only access.
2. Member can add manually and import into the existing Vault but cannot edit/delete.
3. Owner sets only that member's edit override to `true`; the member continues inheriting add while gaining edit.
4. Owner sets only that member's add override to `false`; add is denied despite the Vault default while edit remains explicitly allowed.
5. Owner returns the add override to `null`; inherited add access returns immediately.
6. Owner grants delete through the member override; the member can soft-delete but cannot restore.
7. Owner changes a capability while the member has a stale open page; the next server mutation is rejected and the UI refreshes.
8. Owner still has all account actions and all owner-only administration.
9. Offline/stale state hides or disables every mutation and queues nothing.
10. Audit history attributes default/override changes and successful member mutations without exposing decrypted content.

## Suggested commit sequence

1. `[docs] Define granular Shared Vault account permissions`
2. `[membership] Persist Vault defaults and nullable member overrides`
3. `[membership] Add owner default/override management APIs and tests`
4. `[account] Authorize Shared Vault add operations by capability`
5. `[account] Authorize edit and soft-delete while keeping restore owner-only`
6. `[audit] Record redacted Shared Vault account mutation actors`
7. `[sync] Carry effective permissions in snapshot schema v2`
8. `[ui] Add member permission management and capability-aware controls`
9. `[archive] Allow add-capable members to import into existing Shared Vaults`
10. `[security] Isolate malformed member-written account ciphertext`
11. `[test] Add end-to-end permission and revocation coverage`

Each mutation commit should include its authorization-denial tests; do not merge a UI-only permission gate before the matching server enforcement exists.

## Completion checks

Run with the repository's mise-managed toolchain and required database configuration:

```sh
pnpm prisma validate
pnpm run lint
pnpm run typecheck
pnpm test
pnpm run test:architecture
pnpm run test:browser
pnpm run build
```

Before declaring complete, inspect the generated Prisma migration, verify existing Vaults default to read-only and existing Viewer rows inherit those defaults, confirm no secrets entered logs/audit/Query state, and test direct HTTP calls that bypass the UI.

## Implementation decisions

1. Vault-wide defaults and independent per-capability member fallback are authoritative.
2. New Shared Vaults and migrated Vaults start with all Vault defaults off.
3. New and re-invited members have all overrides unset and inherit current Vault defaults.
4. Delete permission grants soft deletion but not restoration.
5. Add permission includes archive import into an existing Shared Vault.
6. Edit permission means authority over the full encrypted TOTP configuration, not only its label.
