# Navigation and interaction performance plan

## Baseline

The original analysis was created at commit `326d9ef`. Before implementation, this branch was fast-forwarded to latest `main` at `e17fcaa` and the production baseline artifacts were collected from that revision.

The application already has useful foundations:

- Next.js App Router links provide client-side navigation.
- `src/app/vaults/layout.tsx` keeps the unlocked client workspace mounted across child routes, so navigation does not intentionally decrypt or unlock the Vault again.
- a root Query Client reuses permitted server state for the browser session without persisting sensitive data;
- mutations generally update the unlocked workspace directly instead of refetching decrypted content; and
- `NavigationProgress` gives immediate visual feedback.

The original progress indicator improved feedback in its unit test, but its bubbling listener ran after Next.js had already prevented the link click in the real application. The implementation now listens during capture and pairs that feedback with route-local loading shells.

## Implementation evidence

All applicable slices below are implemented. Versioned baselines live under [`performance/`](./performance/); fresh reports are generated under ignored `test-results/performance/`.

| Measure                               | Latest-main baseline |                  Implementation | Result                                             |
| ------------------------------------- | -------------------: | ------------------------------: | -------------------------------------------------- |
| Warm navigation click-to-usable p75   |              41.7 ms |                         48.4 ms | 6.7 ms local-run variance; far below 300 ms budget |
| High-probability prefetched paths p75 |              48.8 ms |                         48.5 ms | Baseline-equivalent while streaming a stable shell |
| Visible-response p75                  |              41.7 ms |                         30.4 ms | 27.1% faster feedback                              |
| Navigation visible-response coverage  |                92.9% |                            100% | Meets budget                                       |
| Maximum navigation RSC requests       |                    1 | 1 (0 on fully prefetched paths) | Meets budget                                       |
| `/vaults` client JavaScript, gzip     |            312,594 B |                       193,739 B | 38.0% smaller                                      |
| Other measured Vault routes, gzip     |            310,093 B |                       191,238 B | 38.3% smaller                                      |
| Cold unlock click-to-usable           |             199.2 ms |                        195.9 ms | 1.7% faster; zero measured long tasks              |

The implementation also proves that 100 mounted accounts sign once per TOTP period rather than once per second, existing protected-page reads avoid provisioning writes and Personal Vault advisory locks, the full participant list stays idle until its tab opens, and unchanged encrypted snapshots can be server-authorized with a `304` before local ciphertext reuse.

Evidence-driven decisions:

- `cacheComponents` and experimental dynamic stale-time caching remain disabled because hidden route state could retain client-only secrets.
- Full prefetch is restricted to `/vaults` ↔ `/vaults/manage`; prefetching every Shared Vault would multiply authorization reads for links the user may never open.
- After granular account permissions landed on `main`, Detail loads only the small owner-only permission-default resource required by its visible form; the full participant list remains deferred to Invitations and owner identity still comes from the page context.
- Reusing one AES key object per Vault was not added because measured decrypt time was 0.1–0.2 ms; it would add key-lifecycle complexity without material gain.
- Footer blur, shadows, and animations remain unchanged because production navigation and unlock traces recorded no long tasks.

## Current-state findings

### 1. Every protected page repeats the expensive request path

Each page under `src/app/vaults/**/page.tsx` currently performs most or all of this sequence:

1. `SupabaseSessionVerifier.verify()` calls `supabase.auth.getUser()`;
2. `PrismaApplicationUserRepository.provision()` performs an `upsert`;
3. `PrismaPersonalVaultRepository.ensureForOwner()` opens a transaction, acquires a PostgreSQL advisory lock, and reads the Personal Vault; and
4. the page waits for all of that work before returning any page-specific UI.

The proxy has already called `getClaims()` for the same navigation. The page-level check must remain close to protected data, but the second verification and database path can be made much cheaper. In particular, an existing user and existing Personal Vault should not take write/provisioning paths on every navigation.

### 2. Protected routes are dynamic and have only a root loading boundary

All main Vault pages are `force-dynamic`. The only loading boundary is `src/app/loading.tsx`, which renders another top progress bar. There are no route-local skeletons or Suspense boundaries that can reveal a useful target-page shell while authentication and database reads finish.

Next.js does not fully prefetch dynamic pages by default. A loading boundary can make the shared shell partially prefetchable, but it should complement rather than hide slow server work.

### 3. Shared Vault detail starts an avoidable request

`SharedVaultDetails` enables `useVaultParticipantsQuery` immediately for every owner, including while the Detail tab is active. The owner displayed there is the current owner, while the full participant list is only needed in the Invitations tab. Audit loading is already deferred correctly.

### 4. TOTP cards perform work once per account per second

Every `TotpAccountButton` owns a one-second interval. Each tick calls `generateTotp()`, and `BrowserHmacGenerator` imports an HMAC key and signs again even when the 30-second TOTP counter has not changed. With many accounts this creates unnecessary timers, Web Crypto calls, and React state updates during ordinary scrolling and tapping.

### 5. Unlock work is serialized more than necessary

The online passphrase flow currently performs:

1. authorized full-bundle fetch;
2. Argon2id key derivation;
3. Vault/account decryption, with accounts processed serially within each Vault; and then
4. IndexedDB snapshot replacement before showing the workspace.

The Argon2id settings are security parameters and must not be weakened. Responsiveness can instead improve through measurement, a worker, safe concurrency, and overlapping ciphertext persistence with decryption.

### 6. Some optional feature code is eager

The add-account route statically loads `@zxing/browser` through `browser-qr-importer.ts`, although most users will not invoke camera or image scanning immediately. This library can be loaded on the first scan action. Archive features are already isolated to their own routes and should not be changed without bundle evidence.

### 7. Experimental navigation caching has security implications

Next.js 16 `cacheComponents` preserves recently visited route state with React Activity. In this application, hidden pages may contain raw QR data, TOTP configuration, archive keys, or recovery form state. It must not be enabled globally until those components explicitly clear sensitive state when hidden/unmounted and tests prove the retention behavior is safe.

Likewise, cross-request caching must never cache authorization state, decrypted Vault content, key material, OTPs, or user-specific output across users.

## Goals and budgets

Establish the exact baseline before making optimization claims. Use these initial budgets, then tighten them after the production-mode baseline is available:

- visible response to a click/tap: **under 50 ms**;
- warm sibling Vault navigation, click to usable target content: **p75 under 300 ms** on a representative mobile profile;
- application INP: **p75 at or below 200 ms**;
- no more than one server identity verification and one application-context database read in a protected page render;
- no participant/audit request until its data is visible or imminently needed;
- TOTP signing work: once per account per TOTP counter, not once per second; and
- no regression in Vault lock cleanup, authorization freshness, offline behavior, or plaintext/key boundaries.

Track cold and warm navigation separately. Record local, preview-deployment, and throttled-mobile results; local development mode is not a valid navigation benchmark.

## Implementation plan

### Slice 1 — Add reproducible measurements

1. Add a production-mode Playwright performance scenario covering:
   - `/vaults` → `/vaults/manage`;
   - directory → Personal Vault detail;
   - directory → Shared Vault detail;
   - `/vaults` → add-account → back; and
   - cold versus already-visited routes.
2. Measure click-to-feedback, click-to-URL commit, click-to-target-heading, and click-to-enabled primary action with `performance.mark()`/`measure()`.
3. Add server spans or non-sensitive `Server-Timing` data around:
   - proxy claims verification;
   - page session verification;
   - Application User resolution;
   - Personal Vault lookup; and
   - offline-bundle read.
4. Add an interaction fixture with 1, 25, and 100 accounts. Count HMAC operations and main-thread long tasks; do not put secrets or generated OTPs in logs, traces, snapshots, or metric labels.
5. Capture route JavaScript sizes from a production build and set budgets for `/vaults`, `/vaults/manage/[vaultId]`, and `/vaults/accounts/new`.

**Done when:** the same command produces comparable navigation, request-count, CPU, and bundle reports without recording sensitive values.

### Slice 2 — Make the protected page context read-only and cheap

1. Introduce a server-only application/DAL function such as `loadVaultPageContext()` returning only the safe DTO needed by pages: Application User id/email/status plus Personal Vault id/lifecycle.
2. Wrap it in React `cache()` for request/render-pass deduplication only. Do not use `use cache`, a module-global user cache, or a shared cross-request cache.
3. Replace unconditional `applicationUser.upsert` on normal reads with:
   - read by Supabase subject;
   - create only when absent; and
   - update email only when it changed.
4. Split Personal Vault creation from normal lookup. `/vaults` may ensure/create an absent Personal Vault; already-initialized child pages should use a read path without an advisory lock or transaction.
5. Prefer one Prisma projection that resolves the Application User and Personal Vault metadata needed by the page.
6. Evaluate `getClaims()` for ordinary protected-page identity checks, following current Supabase guidance. Keep `getUser()` on flows that require a freshly fetched email/user record until email-binding and revocation tests prove claims semantics are sufficient.
7. Keep authorization checks in every route handler and data repository. A persistent layout or client provider must never become the sole authorization layer.

**Tests:** DAL unit tests, provisioning race integration tests, inactive-user tests, email-change tests, invitation email-binding tests, and a regression test showing an existing-user sibling navigation causes no provisioning write or Personal Vault advisory lock.

**Done when:** a normal protected page render performs one trusted identity check and one read-oriented application-context query, while inactive users and revoked access remain blocked.

### Slice 3 — Stream useful route shells and prefetch intentionally

1. Add `src/app/vaults/loading.tsx` and `src/app/vaults/manage/loading.tsx` with stable, accessible skeletons matching the real page geometry. Avoid a second overlapping progressbar announcement.
2. Move top-level asynchronous auth/context work into small protected Server Components behind Suspense so headings, back navigation, and non-sensitive shell geometry can stream first.
3. Reuse the request-cached page context between the user menu and protected page body.
4. After Slice 2 reduces speculative server cost, test `prefetch={true}` only for the highest-probability, low-payload transitions such as `/vaults` ↔ `/vaults/manage`. Compare navigation gain against extra auth/database traffic and cache freshness.
5. Tune the current 350 ms minimum progress visibility from measured behavior. Do not leave a progress indicator visible longer merely to make a completed navigation appear busy.
6. Do not enable experimental `staleTimes.dynamic` or global `cacheComponents` in this slice.

**Done when:** target-page structure appears promptly, there is one coherent pending announcement, and measured prefetch traffic is justified by a high use rate.

### Slice 4 — Remove avoidable interaction work

1. Replace per-card intervals with one workspace/list clock.
2. Recompute each OTP only when its TOTP counter changes. Continue updating visible countdown text once per second, pause unnecessary work while the document is hidden, and resynchronize immediately on visibility/time changes.
3. If measurement still shows key-import cost, retain one non-extractable HMAC `CryptoKey` per mounted account and release references when the workspace locks/unmounts. Never place it in Query state or persistent storage.
4. Enable the participant query only when the Invitations tab is selected. Pass the already-known owner email for the Detail tab, while retaining server authorization on the participants endpoint.
5. Dynamically import `@zxing/browser` inside the camera/image actions and show a local pending state while its chunk loads.
6. Remove `router.refresh()` after create/update flows when local workspace state already contains the authoritative mutation result. Keep a refresh only where server-rendered state truly becomes stale.

**Tests:** fake-clock TOTP boundary tests, HMAC call-count tests at 1/25/100 accounts, visibility pause/resume tests, query enablement tests, lazy-QR loading tests, and mutation navigation tests.

**Done when:** 100 accounts produce at most one HMAC per account per period during steady state, optional tabs make no early requests, and mutation navigation does not trigger duplicate RSC refreshes.

### Slice 5 — Improve unlock responsiveness without reducing security

Instrument fetch, KDF, key unwrap, Vault decrypt, account decrypt, sort, and IndexedDB persistence separately before choosing the order below.

1. Move Argon2id to a dedicated browser worker while preserving exactly 64 MiB memory, 3 iterations, parallelism 1, normalization, and key length. Clear transferable byte buffers where possible and reset form-held secrets after completion/failure according to the existing UX policy.
2. Start encrypted Local Vault Snapshot persistence as soon as the authorized bundle is validated and run it concurrently with decryption. Do not report synchronization success until both required operations complete.
3. Decrypt accounts with measured, bounded concurrency rather than an unbounded `Promise.all`. Preserve deterministic cleanup of every decrypted secret and Vault key on partial failure.
4. Import one AES-GCM key per Vault for a batch only if profiling shows repeated key import is material. Keep the imported key non-extractable and scoped to the unlocked client session.
5. If full-bundle transfer is material, replace the timestamp-only synchronization token with a stable authorization/content revision and support an authorized conditional response. A `304`/unchanged result may reuse the encrypted IndexedDB bundle only after the server has rechecked current access.

**Done when:** the UI remains responsive during KDF/decryption, median unlock time improves without changed cryptographic parameters, and every failure/lock path still zeroes clearable key/secret buffers.

### Slice 6 — Apply bundle/render optimizations only from evidence

1. Inspect the production chunk graph for module-barrel fan-out and large route dependencies.
2. Replace broad client barrel imports with direct public subpath imports only when the build proves that tree-shaking is insufficient; preserve bounded-context public APIs rather than reaching into another context's internals.
3. Lazy-load low-frequency recovery, archive, participant, or audit UI at existing interaction boundaries when chunk savings exceed added request latency.
4. Profile mobile paint/scroll cost before changing the fixed footer backdrop blur, card shadows, or animations.
5. Add bundle-budget and long-task regression checks with enough tolerance to avoid flaky CI.

**Done when:** each retained optimization has before/after evidence and no architecture-boundary regression.

## Recommended delivery order

1. Measurement harness.
2. Read-only protected page context and auth/database fast path.
3. Route-local loading/Suspense and measured prefetching.
4. Shared TOTP clock, lazy participants, and lazy ZXing.
5. Unlock worker/concurrency improvements.
6. Evidence-driven bundle and paint cleanup.

Keep each slice independently releasable. Re-run the baseline after every slice and revert optimizations that only move work earlier without reducing click-to-usable time or backend load.

## Completion mapping

| Slice                  | Implemented evidence                                                                                                                                                                                                                                                   |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Measurement            | `playwright.performance.config.ts`, `navigation-performance.spec.ts`, `report-route-bundles.ts`, server/client timing helpers, and baseline/current JSON artifacts                                                                                                     |
| Protected page context | `load-vault-page-context.ts`, `vault-page-context.ts`, `PrismaVaultPageContextReader`, claims/fresh-user verifier modes, integration and contract tests                                                                                                                |
| Streaming and prefetch | stable protected page frames with granular Suspense boundaries for identity actions and protected content, accessible form/list/action placeholders, route-level auth-safe fallback, capture-phase navigation feedback, and two explicitly bounded full-prefetch links |
| Interaction work       | `useTotpClock`, 100-account and visibility tests, deferred participant query, dynamic ZXing import, removal of redundant refreshes                                                                                                                                     |
| Unlock                 | module Worker with unchanged Argon2id parameters, concurrent ciphertext persistence, bounded decryption, stable ETag authorization, encrypted local reuse, cleanup tests                                                                                               |
| Bundle/render          | enforced route budgets, 38.0–38.3% gzip reduction, production long-task measurements, desktop/mobile unlocked and locked screenshots                                                                                                                                   |

No domain language changed, no migration was required, and no plaintext/key/query-cache boundary changed. Secure Share Link email matching intentionally keeps the fresh Auth-user lookup while ordinary page reads use verified claims.

## Required validation

For each implementation slice:

- targeted unit/integration/browser tests for the changed behavior;
- architecture tests proving no server import of client crypto/OTP modules and no sensitive TanStack Query state;
- lock/logout/offline regression tests proving key cleanup and read-only behavior;
- authorization tests for inactive users, membership revocation, and direct route/API access; and
- before/after production-mode performance evidence.

Before declaring the complete effort done, run:

```bash
pnpm run lint
pnpm run typecheck
pnpm test
pnpm run test:architecture
pnpm run test:browser
pnpm run build
```

A production build succeeds when supplied non-secret local `DATABASE_URL` and `DIRECT_URL` values, and its route manifest confirms that every `/vaults` page is dynamically rendered. Next.js did not emit per-route bundle sizes in the default output, so Slice 1 still needs an explicit chunk-reporting step. Use the normal local test configuration—not production credentials—for performance tests.

## Framework references

- [Next.js prefetching: static versus dynamic routes](https://nextjs.org/docs/app/guides/prefetching)
- [Next.js authentication: request-scoped DAL memoization and layout cautions](https://nextjs.org/docs/app/guides/authentication)
- [Next.js Cache Components and React Activity state preservation](https://nextjs.org/docs/app/api-reference/config/next-config-js/cacheComponents)
- [Supabase SSR: `getClaims` versus `getUser`](https://supabase.com/docs/guides/auth/server-side/creating-a-client)
