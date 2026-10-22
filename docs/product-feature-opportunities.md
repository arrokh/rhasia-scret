# Product feature opportunities

This is a research-backed brainstorm, not an approved roadmap or evidence of user demand. Estimates are qualitative. The project roadmap says security, dependency, and release-evidence blockers take priority over feature expansion.

## Current product baseline

- Account setup already supports one account at a time through a camera scan, QR image, or `otpauth://totp` URI. See [MVP slice 6](mvp-plan.md#slice-6--qr-import) and `apps/web/src/modules/authenticator-account/presentation/authenticator-account-creator.tsx`.
- The account directory already supports Vault and issuer filters, display density, and custom ordering. It does not provide free-text search. See `apps/web/src/modules/authenticator-account/presentation/account-directory-controls.tsx`.
- Encrypted Vault Archives already support client-side export, preview, duplicate checks, and import. Archives are manual snapshots and require a separate key; they do not update automatically. See [Encrypted Vault Archive export and import](encrypted-vault-backup.md).
- The existing account-copy flow covers Local ↔ Personal Vaults. Shared Vault copying is not enabled. See `apps/web/src/modules/local-vault/presentation/local-vault-copy-panel.tsx` and [ADR-0037](adr/0037-local-profile-and-local-vault-semantics.md).
- The service worker activates immediately and claims existing clients; there is no update-ready prompt. See `apps/web/public/sw.js` and `apps/web/src/modules/sync/presentation/service-worker-registration.tsx`.

## Ranked ideas

### 1. Add client-only account search — best low-risk first bet

**User outcome:** Find an account quickly by issuer or account name, across the currently unlocked directory. Keep the existing Vault and issuer filters as complementary controls.

**Why it fits:** The directory has filters and ordering, but no free-text query. Google Authenticator's help describes searching its codes by username, which is a useful first-party example of this basic navigation feature ([Google Authenticator help](https://support.google.com/accounts/answer/1066447?hl=en)).

**Scope:** Small. Search decrypted values in memory only; never persist the query or send it through analytics, URLs, or TanStack Query. Clear it when the workspace locks. Keep keyboard and screen-reader behavior accessible.

### 2. Build a batch migration/import assistant — biggest onboarding opportunity

**User outcome:** Move several accounts from another authenticator without repeating the current one-account-at-a-time setup flow.

**Why it fits:** First-party competitor documentation supports migration from other authenticator formats. Ente documents imports from apps including Aegis, 2FAS, and Bitwarden, plus multiple `otpauth://` entries in a text file ([Ente migration guide](https://ente.com/help/auth/migration/import)). Bitwarden documents imports from Google Authenticator transfer QR codes and exports from other apps ([Bitwarden import/export](https://bitwarden.com/help/authenticator-import-export/)). This is market evidence for the workflow, not proof of demand from rhasia-scret users.

**Scope:** Medium to large, depending on the formats supported. Start with multiple standard TOTP URIs and a locally parsed file format; add vendor-specific formats only after validating their schemas. Preview entries, report invalid records, detect duplicates, select a destination, re-check its add permission, and make partial/atomic completion behavior clear.

**Security guardrails:** Source files, QR payloads, URIs, and TOTP secrets stay in authorized client memory. Do not upload, persist, log, or send them to analytics or query caches. Re-encrypt each accepted account for its destination and clear temporary secret buffers where possible.

### 3. Improve browser-held data readiness and resilience

**User outcome:** Make offline availability more predictable and reduce the chance that a person loses a Local Vault when browser storage is removed or evicted.

**Why it fits:** Local Vault data has no server recovery or synchronization; recovery depends on a previously exported archive and its separate key ([ADR-0037](adr/0037-local-profile-and-local-vault-semantics.md), [archive guide](encrypted-vault-backup.md)). Hosted offline snapshots are also browser-held. MDN describes browser storage as best-effort by default and documents `navigator.storage.persist()` as a user-agent-controlled request that can reduce automatic eviction ([storage quotas and eviction](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria), [StorageManager](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager)). Ente Auth's export guidance also recommends keeping encrypted backups separately and testing an import before relying on the backup ([Ente Auth export guide](https://help.ente.io/auth/migration/export)).

**Scope:** Small to medium. Where supported, add an explicit “protect offline data” action that reports whether browser persistence was granted, plus a quiet Local Vault archive reminder and a direct path to the existing export/restore-preview flow. Keep any “last exported” marker local to the browser. Browser support and grant behavior vary; a persistence grant is not a backup and does not prevent the user from clearing site data. The app cannot know whether the downloaded archive and key were retained or stored separately; do not promise recovery.

### 4. Add encrypted tags or collections

**User outcome:** Group accounts by purpose (for example, work or household) instead of relying only on Vault/issuer filters and manual ordering.

**Why it fits:** Ente Auth documents tags, pins, and search as organization features ([Ente Auth features](https://ente.com/auth/)). The current directory already has issuer/Vault filters and custom ordering, so user-defined groupings would add a distinct way to organize larger collections.

**Scope:** Medium. Store tag names only inside client-encrypted account content; include them in archive import/export and version any affected payload contracts. Do not expose tags to server-side search, audit text, logs, or analytics because tag names can reveal sensitive relationships.

### 5. Consider a next-code preview near rollover

**User outcome:** Let a person see the upcoming code before the current one expires. Ente Auth advertises a “Next code” display ([Ente Auth features](https://ente.com/auth/)); the current rhasia-scret card displays the current code, expiry countdown, and near-expiry warning (`apps/web/src/modules/otp-runtime/presentation/totp-account-button.tsx`).

**Scope:** Small, client-side presentation work. Clearly label the value as “next—not active yet,” show it only near rollover, and keep copy actions tied to the current code. A second visible OTP increases shoulder-surfing exposure and may confuse users, so validate the timing and wording before shipping.

### 6. Add a user-safe PWA update flow

**User outcome:** Tell users when a new app version is ready and let them apply it at a safe point, such as after locking the current workspace, rather than silently taking over the service worker during an active session.

**Why it fits:** The current service worker calls `skipWaiting()` during install and `clients.claim()` on activation, while the registration component has no update-ready prompt (`apps/web/public/sw.js`, `apps/web/src/modules/sync/presentation/service-worker-registration.tsx`). MDN documents a waiting-worker update prompt and warns that a new worker can control a page still running old code ([Using Service Workers](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers)).

**Scope:** Medium. Add a localized accessible prompt and an explicit apply path that locks or reloads only after the user agrees. Do not let updates wait indefinitely: preserve an immediate path for important security fixes and a clear update on the next navigation. Keep user data and API/auth responses out of service-worker caches.

### 7. Consider explicit Shared-to-owned-Vault account copying

**User outcome:** Let an authorized Shared Vault member copy selected account configurations into their own Personal or Local Vault instead of recreating them manually.

**Why it fits:** Current copy support is Local ↔ Personal only, while Shared Vault members can read and use accounts. The repository explicitly leaves Shared Vault copying out of the Local Vault contract for now ([ADR-0037](adr/0037-local-profile-and-local-vault-semantics.md)).

**Scope:** Medium to large; requires a product decision before implementation. Make the action explicit, confirm the destination, and consider a redacted source-Vault audit event. Explain that the copied secret remains usable after membership revocation; revocation cannot erase information a member already learned ([ADR-0009](adr/0009-authorization-only-membership-revocation.md)). Do not imply that copying is reversible or that revocation deletes the copy.

### 8. Add an owner-only audit-history download

**User outcome:** Let Vault owners retain or analyze the existing paginated Vault Audit History outside the application.

**Why it fits:** The product already records redacted security events and displays a paginated history, but does not offer a download. See `apps/web/src/modules/audit/presentation/vault-audit-history.tsx` and the [Vault Audit History contract](../CONTEXT.md).

**Scope:** Small to medium. Keep export owner-only and bounded by the same retention and filters. Use a safe structured format; if CSV is offered, prevent spreadsheet-formula injection. Clearly disclose that the existing permitted audit data can include actor email and opaque identifiers. Never add TOTP configuration, secrets, OTPs, or decrypted account content to the export.

## Ideas to defer

Do not treat native applications, automatic Local Vault synchronization, Shared Vault offline access, queued offline mutations, or HOTP as quick wins. They conflict with accepted product boundaries or require new domain and security decisions. See [ADR-0054](adr/0054-web-pwa-sole-supported-client.md), [ADR-0037](adr/0037-local-profile-and-local-vault-semantics.md), [ADR-0052](adr/0052-personal-only-hosted-offline-snapshots.md), and `CONTEXT.md`.

A browser extension for OTP autofill could reduce app switching—1Password documents OTP autofill, while 2FAS explains that automatic field detection needs broad page permissions ([1Password OTP guide](https://support.1password.com/one-time-passwords/), [2FAS permission explanation](https://2fas.com/support/2fas-auth-browser-extension/why-the-2fas-browser-extension-requires-permission-to-read-and-change-all-your-data/)). Defer it until another supported client is explicitly approved and its page-access threat model is reviewed. If pursued, prefer exact-origin association and user-initiated fill over background page scanning.

## Suggested next step

If release and security gates are clear, validate the search and migration ideas with a few users. Search is the smallest safe improvement; batch migration has the largest onboarding upside but needs a tighter format and failure-handling design before an implementation issue is opened.
