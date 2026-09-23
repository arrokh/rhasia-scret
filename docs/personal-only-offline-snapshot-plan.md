# Personal-only offline snapshot plan

## Status

**Implemented.** The Personal-only v3 snapshot, transient online workspace contract, browser/native migration, lifecycle eviction, documentation, and validation changes are in the working tree. Release gates and deployment evidence remain required before rollout.

This plan changes hosted offline access so that only the server-backed **Personal Vault** is available through a **Local Vault Snapshot**. Shared Vaults remain online-only. The independent writable **Local Vault** remains unchanged.

## 1. Executive decision

Adopt this rule:

> A Local Vault Snapshot may contain only the authenticated user's Personal Vault. A Shared Vault must never be persisted in, unlocked from, or presented through an offline snapshot.

This is the strongest revocation guarantee available within the current client/server model. A disconnected client cannot receive a membership revocation, and a client that already received a Shared Vault key and ciphertext cannot be remotely forced to forget it. An already-open online workspace remains subject to the product's defined refresh/revalidation cadence; Personal-only snapshots do not provide an immediate online revocation signal.

This rule does **not** revoke a TOTP secret that B already viewed, copied, photographed, exported, or re-entered elsewhere. Full credential revocation still requires resetting the TOTP credential at the original service.

## 2. Current-state assessment

### 2.1 Current data flow

Before this implementation, the hosted offline bundle contained:

- the encrypted Personal Vault profile, name, key material, and accounts; and
- every active Shared Vault membership, including encrypted Shared Vault names, member key wraps, account ciphertext, role, and effective account permissions.

The relevant implementation is `apps/api/src/modules/sync/infrastructure/prisma-offline-sync-bundle-reader.ts`. The client persists the encrypted bundle in browser-owned IndexedDB or native encrypted file storage, then `packages/client-vault-core/src/modules/authenticator-account/application/vault-workspace.ts` decrypts both Personal and Shared Vault entries when the snapshot is opened.

Offline workspaces are already read-only: mutations are disabled and never queued. However, a stale snapshot can still generate OTPs until a successful online synchronization proves that authorization has changed.

### 2.2 Revocation limitation

Membership revocation currently denies future server access. It cannot erase:

- a Shared Vault Encryption Key already delivered to B;
- Shared Vault ciphertext already persisted on B's device;
- plaintext or OTPs already observed by B; or
- copies B made outside application storage.

A successful later synchronization can remove a revoked Shared Vault from the current workspace and persisted snapshot, but this is eventual cleanup rather than offline revocation.

### 2.3 Security conclusion

Encryption at rest protects a snapshot from a storage reader who lacks the local unlock path. It does not protect against the authorized member using their own client-side key after revocation. Therefore, excluding Shared Vaults from offline snapshots is preferable to attempting to solve this with key rotation, push notifications, or client-side timers.

### 2.4 Considered options

| Option                                    | Revocation behavior                                                                                   | Security/UX assessment                                                                            |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Current: Personal + Shared offline        | Shared access can continue while B is offline and the snapshot remains usable                         | Best offline convenience, but does not meet a strict revocation requirement                       |
| Personal-only offline (recommended)       | Shared Vault is never present offline; reconnect is required after revocation or before Shared access | Strongest practical guarantee with a clear product rule; Shared Vault offline convenience is lost |
| Shared offline with a time-to-live        | Limits how long a stale snapshot may be used, but cannot guarantee immediate revocation               | Adds complexity and clock/tampering concerns; still leaves a revocation window                    |
| Push/websocket revocation                 | Can accelerate cleanup for connected clients                                                          | Useful as a best-effort optimization, but cannot protect a disconnected client                    |
| Rotate the Shared Vault key on revocation | Blocks future access to newly fetched ciphertext                                                      | Does not erase an old snapshot whose old key and ciphertext B already possesses                   |

A future Shared Vault offline mode would require an explicitly accepted bounded-revocation window and a separate threat-model decision. It should not be smuggled back into the Personal-only contract through a permissive parser or compatibility path.

### 2.5 Online workspace must remain separate from offline persistence

Before this implementation, the online unlock path and offline path both fetched `/v1/sync/offline-bundle`, and its full-workspace bundle shape was used both to render the online Shared Vault directory and to persist the offline snapshot. Removing `sharedVaults` from that response without replacing the online path would have unintentionally broken authorized online Shared Vault access.

The implementation must split the contracts:

- **Online workspace response:** may contain the Personal Vault and currently authorized Shared Vaults for immediate in-memory use only. It must be authenticated, `no-store`, excluded from service-worker/API caches, and never accepted by the snapshot storage port.
- **Personal offline snapshot:** contains only the Personal Vault and is the only value accepted by browser/native snapshot storage.

The recommended transport is a new versioned `GET /v1/sync/workspace-bundle` response containing a Personal-only snapshot projection plus transient Shared Vault entries, all read in one consistent server transaction. The client composes the online workspace from the response, persists only the Personal-only projection, and clears all transient Shared material after replacement/lock. The existing `/v1/sync/offline-bundle` contract remains a legacy compatibility path during rollout and is not used by the new client. If the implementation instead uses two endpoints, it must preserve equivalent consistency and must document the additional request and revision semantics.

## 3. Goals

1. Preserve read-only offline OTP generation for the Personal Vault.
2. Prevent new Shared Vault ciphertext, names, key wraps, and permission metadata from entering offline snapshots.
3. Prevent existing snapshots containing Shared Vaults from being opened by the updated client.
4. Remove Shared Vaults from active workspaces and persisted storage after confirmed online authorization loss.
5. Keep browser and native behavior aligned.
6. Preserve the separation between Personal Vault, Shared Vault, Local Vault, and Local Vault Snapshot.
7. Make the revocation limitation and offline authorization state explicit in product copy and security documentation.
8. Preserve the existing no-plaintext-storage, no-offline-mutation-queue, and client-only key boundaries.

## 4. Non-goals and explicit limitations

- Do not add Shared Vault → Local Vault copying.
- Do not make the writable Local Vault server-backed or synchronized.
- Do not add offline Shared Vault mutation, replay, merge, or deletion propagation.
- Do not claim that revocation erases secrets previously learned by a member.
- Do not treat `navigator.onLine`, AppState, a push notification, a client timer, or a changed UI control as proof of server authorization.
- Do not use server-side key rotation as a substitute for removing Shared Vaults from offline storage.
- Do not change the TOTP format, account encryption contract, archive contract, or database schema unless implementation discovers a separately required change.

## 5. Proposed contract and policy

### 5.1 Offline eligibility

| Data type      | Offline snapshot                 | Offline mutations                       |
| -------------- | -------------------------------- | --------------------------------------- |
| Personal Vault | Allowed, encrypted, read-only    | Never allowed or queued                 |
| Shared Vault   | Never included                   | Not applicable                          |
| Local Vault    | Independent browser-only storage | Explicit local mutations remain allowed |

The term **Local Vault Snapshot** must continue to mean a server-derived encrypted snapshot, not the writable Local Vault.

### 5.2 Snapshot and online-workspace contracts

Introduce a new Personal-only offline snapshot contract, recommended as v3, with no Shared Vault collection. Define a separate online-workspace response contract for transient Shared Vault access. Do not use one permissive type for both values.

The snapshot storage port must accept only the Personal-only snapshot type. The online workspace transport must return a distinct type that cannot be passed to `snapshotStore.replace` without an explicit Personal-only projection. This gives the client a compile-time and runtime boundary against accidentally persisting Shared Vault data.

The new online response must expose independently identifiable synchronization metadata for the Personal snapshot and the transient online workspace. A full-workspace revision must not be reused as a Personal-only snapshot revision unless the server explicitly defines that relationship. Conditional `304` handling must never cause a cached legacy/full bundle to be treated as a Personal-only snapshot.

The recommended response shape is:

```text
AuthorizedWorkspaceResponse {
  responseVersion
  workspaceSynchronizationToken
  synchronizedAt
  personalSnapshot: EncryptedPersonalOfflineSnapshot
  sharedVaults: EncryptedOnlineSharedVault[]
}
```

`personalSnapshot` is the exact value accepted by `OfflineVaultSnapshotStore`; `sharedVaults` is accepted only by the transient online workspace composer. The server creates both portions from one authorization-consistent read. The response uses `Cache-Control: no-store, private`, and the client does not put it in a query cache, service-worker cache, browser storage, native file, log, or analytics payload. A first implementation may use `200` for every online workspace read; if `304` is added later, it may reuse only an in-memory full-workspace response whose revision is known.

Legacy v1/v2 snapshots must not be silently migrated by copying their Personal portion while leaving the old synchronization token and metadata semantics ambiguous. If a legacy snapshot may contain Shared Vault data, the updated client must reject and clear it, then require a successful online synchronization before recreating a Personal-only snapshot.

If implementation chooses to retain an empty `sharedVaults` field for wire compatibility, the field must be typed and validated as permanently empty for the Personal-only contract. A non-empty collection must fail closed and trigger legacy snapshot cleanup. The legacy full online response may retain Shared Vaults only for the separately authenticated, transient online-workspace contract.

### 5.3 Authorization behavior

- Online Shared Vault access continues to require active membership and server authorization.
- A successful online synchronization that omits a previously cached Shared Vault must remove that Shared Vault from memory and storage.
- A confirmed Shared Vault authorization failure from an online Shared Vault operation should evict that Shared Vault from the active workspace and trigger snapshot cleanup.
- A transient network failure must not be presented as a successful authorization decision.
- Personal Vault stale/offline behavior may remain read-only as it is today, provided the UI clearly states that authorization and server time cannot be checked.

### 5.4 End-to-end data flows

#### Online unlock or refresh

1. The authenticated client requests the versioned online-workspace response with fresh application authorization.
2. The server reads the Personal Vault, active Shared memberships, encrypted records, and current authorization state in one consistent transaction.
3. The response returns Shared Vault material only for the transient online workspace, plus a Personal-only snapshot projection and independent synchronization metadata.
4. The client strictly parses both contracts, derives/recovers the User Root Key, decrypts Personal and currently authorized Shared Vaults in memory, and validates account payloads.
5. The client atomically persists only the Personal-only projection. It must not persist or pass the full response to a storage/query/cache API.
6. Only after required decryption and snapshot persistence succeed does the client publish the workspace as current. Any failure clears newly recovered keys and retains the previous valid state according to the selected failure policy.

#### Online revocation or connectivity loss

1. A refresh, Shared Vault request, visibility event, network transition, or server denial triggers the workspace lifecycle's authorization path.
2. If a successful response omits a Shared Vault, or a Shared-specific authorization failure confirms loss of membership, the client clears that Shared Vault's keys, decrypted accounts, route state, and any legacy persisted copy.
3. If network reachability is lost or authorization cannot be confirmed, the client evicts Shared Vault material before entering offline/stale mode. Personal Vault may remain read-only if approved.
4. A successful later synchronization persists a new Personal-only projection and restores only Shared Vaults that are currently authorized.

#### Offline unlock

1. The client discovers a Personal-only snapshot without contacting the server.
2. The client rejects and removes a legacy or non-Personal snapshot before asking to display accounts.
3. The user unlocks with the Local Vault Snapshot's configured local recovery path; the client decrypts Personal Vault content only.
4. The UI exposes OTP generation and explicit copy as read-only local actions. It exposes no Shared Vault, membership, invitation, mutation, audit-write, or archive-import path.

#### Logout, clear, and user switching

1. Logout or explicit hosted-data cleanup clears the unlocked hosted workspace, Personal-only snapshots, and Remembered Browser/session material according to existing policy.
2. It never clears the independent writable Local Profile/Local Vault unless the user separately chooses the Local Vault clear action.
3. User switching cannot reuse a prior user's snapshot, User Root Key, Shared Vault key, or decrypted account state.

#### Online mutations and read-after-update

1. Online account, membership, permission, archive, and Vault lifecycle mutations continue to use their existing server authorization and revision checks.
2. After a successful mutation, the client refreshes the online workspace and atomically replaces only the Personal-only snapshot projection.
3. Offline/stale workspaces never issue, queue, replay, or infer successful server mutations.

## 6. Acceptance criteria

### AC-01 — Separate online workspace and offline snapshot contracts

Authorized online access continues to receive the active Shared Vault material needed to render and use Shared Vaults, but only through the transient online-workspace response. The Personal-only snapshot projection is the only value accepted by browser/native snapshot storage. The online response and snapshot projection are produced from one consistent authorization read, or the plan documents and tests an equivalent revision/consistency protocol.

The online response is `no-store`, has no service-worker/API cache path, and is never placed in TanStack Query, browser persistence, native snapshot storage, logs, or analytics.

**Evidence:** online workspace integration test proves Shared Vault access remains functional; transport/port tests prove the full response cannot be passed to snapshot storage; response-header and cache-boundary tests prove transient handling.

### AC-02 — Personal-only snapshot contract

The Personal-only snapshot contains no Shared Vault IDs, names, account ciphertext, encrypted Vault keys, roles, membership permissions, or member metadata. Its parser and domain types cannot produce an unlocked Shared Vault.

**Evidence:** snapshot parser tests, type-level review, API/projection contract tests, and workspace tests.

### AC-03 — Legacy snapshot cleanup

A browser or native snapshot created under the old contract that contains Shared Vault data is never opened offline by the updated client. It is deleted before unlock; if deletion fails, storage fails closed and the user is told to reconnect or explicitly clear hosted snapshot data before offline access is available again. Discovery returns an explicit migration-required state rather than silently dropping the profile from the picker.

**Evidence:** browser IndexedDB migration tests, native file/secure-key migration tests, and presentation tests for the reconnect state.

### AC-04 — No Shared Vault persistence after online synchronization

After a successful online workspace synchronization, the client persists only the Personal-only snapshot projection. Browser and native storage contain no Shared Vault encrypted payload, key wrap, name, or permission data. The Personal Vault snapshot remains available, and the in-memory online workspace still contains authorized Shared Vaults until lock, eviction, or replacement.

**Evidence:** storage inspection tests using synthetic fixtures, transport/projection assertions, and online Shared Vault rendering tests.

### AC-05 — Offline UI shows Personal Vault only

Offline profile summaries, account lists, labels, counts, unlock flows, and empty states do not claim or display Shared Vault availability. Shared Vault navigation and mutations are unavailable offline.

**Evidence:** web browser tests, native presentation tests, and both locale assertions.

### AC-06 — Online-to-offline Shared Vault eviction

When an active online workspace loses network reachability or fails the required online authorization refresh, Shared Vault keys, decrypted Shared accounts, names, and permission state are removed from the in-memory workspace before the UI enters offline/stale mode. The Personal Vault may remain available read-only. A network indicator must never be used to grant access; conservative eviction on uncertain reachability is acceptable.

**Evidence:** workspace lifecycle tests that transition from online to offline, inspect the resulting vault/account set, verify key cleanup, and confirm Personal-only offline UI.

### AC-07 — Revocation reconciliation

If A revokes B while B is offline, B cannot open a Shared Vault through a current Personal-only snapshot. After B reconnects, a successful sync produces a Personal-only snapshot and the Shared Vault is absent from the active workspace and storage.

**Evidence:** end-to-end/browser journey and native lifecycle test with synthetic encrypted fixtures.

### AC-08 — Failed synchronization does not create false authorization

A network failure, malformed response, or failed authentication does not mark the Personal snapshot as currently authorized. A global online `401` clears the active hosted workspace while retaining only the encrypted Personal snapshot for explicit offline unlock; network loss, timeout, malformed success, or Shared-specific denial evicts Shared material before stale/offline presentation. No Shared Vault is resurrected from old data.

**Evidence:** lifecycle state tests and browser reconnection tests.

### AC-09 — Confirmed online Shared Vault denial clears active data

A confirmed Shared Vault membership denial or a successful bundle that omits the Shared Vault clears the affected in-memory key material, decrypted accounts, and persisted Shared Vault data without clearing unrelated Personal Vault data.

**Evidence:** workspace lifecycle tests, storage tests, and key-zeroization assertions where the platform permits them.

### AC-10 — No offline mutation path

Offline account creation, editing, deletion, invitations, membership changes, permission changes, archive operations, and audit writes remain disabled and are never queued or replayed.

**Evidence:** existing mutation-gate tests extended to the Personal-only snapshot contract.

### AC-11 — Browser/native parity

Browser IndexedDB and native encrypted file storage enforce the same Personal-only policy, legacy cleanup behavior, state labels, and revocation semantics. Native AppState backgrounding continues to clear unlocked workspace key material.

**Evidence:** shared contract tests plus platform-specific tests.

### AC-12 — Security boundary remains intact

Plaintext TOTP secrets, OTPs, decrypted account content, Vault Encryption Keys, User Root Keys, passphrases, and raw QR data remain absent from server persistence, logs, analytics, service-worker caches, TanStack Query state, and offline ciphertext metadata.

**Evidence:** architecture tests, storage inspection, API payload assertions, and secret-scan-safe synthetic fixtures.

### AC-13 — Documentation and localization are consistent

All affected domain definitions, ADRs, security guidance, UI reference material, user-facing messages, and English/Indonesian catalogs describe Personal-only offline snapshots and Shared Vault online-only behavior with exact parity.

**Evidence:** documentation review, catalog parity tests, hard-coded-copy tests, and updated preview/browser/native coverage.

### AC-14 — Rollout behavior is explicit

The product and release notes document that already-installed old clients may retain old Shared Vault snapshots until they reconnect and update. A minimum supported client/version policy is evaluated if the threat model requires stronger rollout control.

**Evidence:** migration tests, release checklist entry, and documented residual risk.

## 7. Action plan

### Phase 0 — Confirm policy and threat-model language

The following are the execution defaults. Change them only with an explicit product/security decision before implementation:

1. The required guarantee is **no Shared Vault use through the updated offline feature**, not retroactive erasure of secrets already learned. Online revocation detection is event-driven in the initial implementation: online workspace load, route/visibility return, network recovery, and relevant successful mutations trigger refresh; no periodic heartbeat is assumed. An immediate guarantee for an already-open client would require a separate online lease/push decision.
2. Shared Vault access is online-only for web and native clients, including after an already-open online workspace loses network reachability.
3. Network loss conservatively evicts Shared Vault material from memory while retaining Personal Vault read-only access when its local key path is still valid.
4. Use the v3 Personal-only snapshot shape with no Shared Vault collection. Retaining an empty compatibility field is not the default and requires an explicit contract review.
5. A global online `401` clears the active hosted workspace from memory; the encrypted Personal-only snapshot is not automatically deleted and can still be opened through the explicit offline flow. A Shared-specific `403`, confirmed membership omission, malformed authorization response, or network loss clears Shared material before stale/offline presentation.
6. Record the final policy in a new ADR because this is a security and product behavior boundary.

### Phase 1 — Update platform-neutral domain and transport contracts

1. Add the new Personal-only snapshot schema/version and parser behavior in `packages/client-vault-core/src/modules/sync/domain/offline-vault-bundle.ts`.
2. Define distinct `EncryptedOnlineWorkspaceBundle` and `EncryptedPersonalOfflineSnapshot` contracts. The online contract may carry transient Shared Vaults; the snapshot contract may not.
3. Update `VaultWorkspaceDataPort`, `AuthorizedWorkspaceTransport`, `apps/web/src/modules/sync/infrastructure/browser-offline-sync-client.ts`, and `apps/mobile/src/infrastructure/mobile-vault-workspace.ts` so online unlock/reconciliation fetches the online workspace contract, while offline unlock reads only the Personal-only snapshot store.
4. Make `OfflineVaultSnapshotStore.replace`, `read`, and `readByPersonalVaultId` accept only the Personal-only snapshot type. Do not rely only on a caller-side convention.
5. Update `packages/client-vault-core/src/modules/authenticator-account/application/vault-workspace.ts` and the browser/native port adapters (`apps/web/src/modules/sync/infrastructure/browser-vault-workspace.ts`, `apps/mobile/src/infrastructure/mobile-vault-workspace.ts`) so online load/refresh composes and decrypts Shared Vaults in memory, then persists only the Personal-only projection; offline loading decrypts Personal Vault data only.
6. Define the independent synchronization metadata for the online workspace and Personal snapshot. Document whether the initial implementation always fetches the full online workspace or supports `304` reuse from an in-memory full-workspace revision; never send a Personal-only snapshot token as if it represented a full workspace response.
7. Update profile summaries, offline sync state, vault status, and storage ports so they no longer imply multiple offline hosted Vaults.
8. Preserve strict parsing, context-bound encryption, revision validation, atomic replacement, and failure-closed behavior.
9. Add unit/contract tests for online full bundles, Personal-only projections, current snapshots, legacy snapshots, malformed bundles, conditional responses, and non-empty Shared Vault rejection.

### Phase 2 — Update server bundle production and routing

1. Add a versioned online-workspace response, preferably `GET /v1/sync/workspace-bundle`, that returns the Personal material plus currently authorized Shared Vault material for transient online use only.
2. Return a Personal-only snapshot projection from the same consistent authorization read, or define a separate personal-snapshot read with an explicit revision/consistency contract. The client must persist only that projection.
3. Keep the existing `GET /v1/sync/offline-bundle` response as a legacy compatibility path until the supported-client cutoff; the new client must not use it for online unlock or snapshot persistence. Do not silently change its shape while old clients depend on it.
4. Define authentication and lifecycle mappings for the new route: use the existing fresh application authentication assurance and preserve the repository's current error conventions (`unauthenticated` 401, `inactive_user` 403, `not_initialized` 404). Add a bounded unsupported-protocol response only if negotiation requires it, map malformed/unsupported responses explicitly, and specify `200`/conditional behavior. Preserve `Cache-Control: no-store, private`; add the required `Vary` behavior if version negotiation uses request headers.
5. Keep online Shared Vault authorization and account endpoints unchanged, but ensure the online workspace response is reauthorized on every required refresh.
6. Update API route registration, route-parity coverage, request/response contract tests, and integration tests to prove both that active Shared memberships remain available online and that the Personal-only projection never contains Shared content.
7. Remove Shared Vault membership/key/account reads from any dedicated Personal-only snapshot reader if one is introduced; do not remove them from the transient online-workspace reader.
8. Confirm no new server-visible metadata, cache path, log field, or analytics field is introduced.

### Phase 3 — Migrate browser storage safely

1. Update `BrowserOfflineVaultRepository` and browser snapshot discovery to detect legacy v1/v2 records before they are offered for unlock.
2. Introduce a typed `legacy_snapshot_requires_online_sync`/migration result distinct from a wrong passphrase, generic storage failure, or corruption. Change discovery from a bare profile array to a result that can report `profiles` plus a non-sensitive migration-required state; do not silently hide a rejected profile from the picker.
3. Delete a known legacy Shared-containing hosted snapshot atomically before presenting offline accounts. If the record cannot be safely classified or deleted, fail closed, show a reconnect/storage message, and do not unlock it.
4. Decide and document whether an unparseable shared IndexedDB store clears only the affected profile or all hosted snapshots. The safest fallback is to clear hosted snapshot storage and its Remembered Browser material without touching the independent Local Vault.
5. Require one successful online workspace synchronization to recreate the Personal-only snapshot.
6. Ensure `OfflineVaultSnapshotStore.replace` can never receive the transient online workspace response.
7. Preserve explicit user-controlled Local Vault data; never clear the independent Local Profile or Local Vault during hosted snapshot migration.
8. Update `apps/web/src/modules/sync/presentation/offline-vault-shell.tsx` and related lifecycle presentation to show profile counts, status labels, migration-required copy, and storage errors for Personal-only snapshots.
9. Add tests for old snapshots with Shared Vaults, old Personal-only snapshots, malformed records, multiple profiles, deletion failures, IndexedDB transaction atomicity, remembered-browser cleanup, and successful rehydration after online sync.

### Phase 4 — Migrate native storage safely

1. Update `EncryptedOfflineVaultStore` and native persistence to distinguish a legacy Shared-containing store from malformed encrypted storage and passphrase/secure-key failures.
2. Because native `load()` currently parses the complete encrypted profile map before returning, make legacy cleanup atomic: do not leave the entire store permanently unreadable when one legacy profile is encountered.
3. Remove the native encrypted snapshot and its storage key when migration cannot prove Personal-only contents, unless a safe per-profile rewrite is implemented and tested.
4. Require online synchronization before recreating the native Personal-only snapshot.
5. Preserve Keychain/Android Keystore boundaries, temporary-buffer cleanup, and AppState cleanup.
6. Ensure the online transient workspace response is never passed to `EncryptedOfflineVaultStore.replace`.
7. Add iOS/Android contract and persistence tests with synthetic encrypted data covering legacy profiles, multiple profiles, secure-key loss, malformed envelopes, atomic deletion, and successful rehydration after online sync.

### Phase 5 — Harden active workspace revocation and connectivity handling

1. On successful refresh, compare the previous and new authorized vault sets and clear removed Shared Vault keys/accounts immediately.
2. On confirmed Shared Vault authorization denial, evict only the affected Shared Vault from memory and any legacy persisted snapshot data.
3. Change the workspace lifecycle so network loss or an online authorization-refresh failure evicts Shared Vault material before entering offline/stale mode; retain Personal Vault only if that behavior is explicitly approved.
4. Add a selective workspace cleanup port/helper rather than calling the existing all-workspace clear path when Personal continuity is intended.
5. Ensure no stale UI component retains decrypted Shared account data after eviction, including account-directory state, route-local state, archive previews, and provider-held key buffers.
6. Keep stale/offline workspaces read-only and visibly distinguish them from current online authorization.
7. Implement the selected failure matrix: global online `401` clears the active hosted workspace but retains the encrypted Personal-only snapshot for explicit offline unlock; Shared-specific `403` or omitted membership evicts only Shared data; malformed success, timeout, and network loss evict Shared data before stale/offline presentation. None of these paths may leave Shared data usable while the client claims only stale status.
8. Define and document the event-driven online Shared Vault revalidation triggers and the fact that the initial implementation has no periodic detection bound. If a periodic lease or pre-copy authorization check is later added, measure its UX and server cost and never describe it as an offline revocation mechanism.
9. Add reconnection, foreground, logout, user-switch, network-loss, failed-refresh, revocation, and concurrent-refresh tests.

### Phase 6 — Update presentation and user-facing behavior

1. Update web offline screens to explain that offline access includes Personal Vault only.
2. Make Shared Vault controls unavailable offline without implying that the Shared Vault was deleted.
3. Add a clear reconnect message when a legacy Shared-containing snapshot is discarded.
4. Update native offline status, unlock, empty, and failure copy.
5. Keep copy concise and avoid exposing Vault names, account labels, secrets, or other decrypted content in telemetry.
6. Update both `apps/web/messages/en.json` and `apps/web/messages/id.json` together, including the offline shell, status indicator, migration-required state, and online/offline Shared Vault wording.
7. Update `apps/mobile/src/localization.ts` with exact English/Indonesian key parity, including native migration and online-only Shared Vault wording.
8. Update any affected previews and their synthetic fixtures.

### Phase 7 — Documentation alignment

Update the following documents as part of the implementation, not as a later cleanup:

1. `CONTEXT.md`
   - redefine Local Vault Snapshot as a read-only copy of the Personal Vault only;
   - state that Shared Vaults require online authorization;
   - retain the distinction from the writable Local Vault;
   - document the residual limitation that already-learned secrets cannot be revoked.

2. `docs/adr/0009-authorization-only-membership-revocation.md`
   - verify that authorization-only revocation remains the server-side rule;
   - cross-reference the stronger client-side policy that Shared Vaults are no longer cached offline.

3. `docs/adr/0016-read-only-offline-pwa-access.md`
   - amend the offline decision to Personal-only hosted access;
   - describe successful reauthorization and stale snapshot cleanup;
   - state that Shared Vaults are not cached offline.

4. `docs/adr/0037-local-profile-and-local-vault-semantics.md`
   - clarify that the independent Local Vault remains writable and unrelated;
   - clarify that Local Vault Snapshot is Personal-only and never a Shared Vault copy;
   - remove any wording that implies arbitrary server Vault synchronization.

5. `docs/adr/0041-platform-neutral-client-ports.md`
   - update the shared port contract and cross-platform snapshot boundary.

6. `docs/adr/0042-expo-react-native-client-foundation.md`
   - document native Personal-only snapshots, migration cleanup, and Shared Vault online-only behavior.

7. `docs/adr/0038-context-bound-encrypted-envelopes.md`
   - update the offline envelope table and tests to reflect the Personal-only contained contexts.

8. `docs/advanced-recovery-security.md`
   - align the compromised-member and device-lifecycle sections with the new policy;
   - explicitly state that no offline Shared Vault copy is retained;
   - retain the requirement to reset original-service TOTP credentials after suspected secret exposure.

9. `docs/security/deployment-hardening-checklist.md`
   - add a verification item for Personal-only snapshot payloads, legacy cleanup, and online-only Shared Vault access.

10. `docs/ui-reference/rhasia-mobile/README.md` and `docs/ui-reference/rhasia-mobile/15-offline-state.md`

- update offline UX guidance, illustrations/copy if needed, and the reconnection/revocation flow.

11. `docs/security/incident-response.md`
    - align the membership-revocation and stolen-session playbooks with Personal-only snapshot cleanup and the residual original-service reset requirement.

12. `apps/mobile/README.md`
    - state that native offline snapshots contain Personal Vault data only and Shared Vault use remains online-only.

13. `docs/analytics-events.md`
    - verify that no new event is needed;
    - if migration or snapshot-cleared analytics are added, define only non-sensitive bounded event names and never include Vault/account content.

14. Add a new ADR, using the next available number at implementation time (currently `0052`), for the Personal-only offline policy and its residual risks.

### Phase 8 — Verification and release gate

1. Run focused unit, contract, integration, browser, and native JavaScript tests.
2. Run architecture and localization parity checks.
3. Inspect browser IndexedDB and native storage fixtures to prove no Shared Vault payload remains.
4. Run the complete repository gate required by `AGENTS.md`:
   - `pnpm run lint`
   - `pnpm run typecheck`
   - `pnpm test`
   - `pnpm run test:architecture`
   - `pnpm run build`
   - `pnpm run test:full`
5. For native release evidence, if the native implementation changes, run `mise exec -- pnpm --dir apps/mobile run build:android-native` and `mise exec -- pnpm --dir apps/mobile run build:ios-simulator`.
6. Do not run database migration commands; this plan should require no database schema migration. If implementation discovers one, stop and obtain separate human approval.
7. Perform a final secret scan and review all changed fixtures, screenshots, logs, and documentation for synthetic non-PII data.
8. Record residual risks and rollout limitations in the release handoff.

## 8. Deployment, compatibility, and rollback

### 8.1 Additive rollout

1. Ship the new online-workspace contract/route and Personal-only snapshot parser on the server before requiring clients to use it.
2. Keep the current `/v1/sync/offline-bundle` contract available for legacy clients during the support window. Do not change its response shape underneath old clients.
3. Ship web and native clients that request the new versioned online-workspace contract and reject any downgrade that could place a full Shared-containing bundle into snapshot storage.
4. Use an explicit request version/Accept header or route version so server behavior is testable. `no-store` responses must include appropriate cache variation if headers select the contract.
5. New clients must fail closed or show retry guidance when the new contract is unavailable; they must never fall back to the legacy full bundle for persistence.
6. Measure adoption and legacy snapshot cleanup before retiring the legacy route. A minimum supported client policy may block legacy online clients after an explicit release decision, but it cannot remotely erase a legacy client's already-offline snapshot.

### 8.2 Rollback

- If the new client has a defect, retain the legacy server route while rolling back the client. This restores old behavior, including the old Shared Vault offline risk, and must be treated as a security rollback rather than an invisible compatibility change.
- Do not roll back the server by changing a Personal-only response into a Shared-containing response for clients that expect the new contract.
- If the new route is unavailable, keep the new client online-only or retry; do not persist a legacy response.
- If storage migration has deleted a legacy snapshot, rollback cannot restore it. The user must perform a fresh online synchronization.
- Record the rollback decision, affected client versions, residual Shared snapshot exposure, and any required TOTP reset guidance.

### 8.3 Database and client-data migration

No Prisma schema or database migration is expected. The migration is client-storage-only and is destructive for legacy hosted snapshots that may contain Shared Vault data. Browser IndexedDB deletion and native encrypted-file/secure-key deletion must be atomic from the user's perspective, and must never touch the independent writable Local Vault. The release checklist must explicitly call out this irreversible local-data change.

## 9. Monitoring, observability, and configuration

1. Add bounded, redacted operational measurements for:
   - online workspace bundle success/failure by protocol version;
   - Personal-only snapshot write success/failure;
   - legacy snapshot rejection/cleanup count;
   - Shared Vault in-memory eviction count and reason category; and
   - client version/protocol mismatch or unsupported-contract count.
2. Do not include user IDs, Vault IDs, account IDs, labels, ciphertext, secrets, keys, OTPs, emails, or raw error bodies in logs, metrics, analytics, or alerts.
3. Reuse existing server operation measurement and client analytics conventions where appropriate; any new event must be an approved bounded event with both locale catalogs if it reaches presentation.
4. Alert on sustained new-contract failures, migration cleanup failures, and unexpected non-empty Shared data reaching the snapshot projection boundary.
5. No new environment variable is required by this plan. If protocol rollout, minimum-client enforcement, or a kill switch becomes configurable, document its owner, default, environment-specific value, and rollback behavior before implementation.
6. Verify browser service-worker routing, HTTP cache headers, native file persistence, and Query Client configuration in deployment checks.
7. Measure online workspace response size, latency, and decryption time before and after the contract split. The response should reuse the Personal snapshot projection as the online Personal material rather than duplicating ciphertext, retain existing bounded account/member queries, and avoid a second full-bundle fetch unless consistency requires it.
8. Ensure snapshot migration and eviction are bounded and serialized so repeated network/visibility events cannot race storage replacement or cleanup.

## 10. Residual risks after implementation

Even after Personal-only snapshots ship:

- B can retain any TOTP secret or OTP already learned while authorized.
- An old client with an old Shared-containing snapshot may remain usable while permanently offline until it updates or its local data is cleared.
- A browser extension, malicious same-origin script, compromised native build, screenshot, clipboard history, or device backup may retain data outside application-controlled storage.
- An already-open authorized Shared Vault workspace cannot be remotely guaranteed to erase itself while the device is disconnected, and a connected workspace may retain access until its next defined authorization refresh.
- TOTP codes copied before revocation may remain valid until their normal validity period ends.

The product must not promise stronger guarantees than these controls provide.

## 11. Expected implementation outcome

After completion:

- B can use B's Personal Vault offline in read-only mode.
- B cannot open a Shared Vault from the supported offline feature.
- A's revocation prevents future online Shared Vault access and removes Shared data during successful reconciliation.
- The independent Local Vault remains unaffected.
- Previously learned TOTP secrets remain outside the application's ability to revoke and require reset at the original service when compromise response is necessary.
