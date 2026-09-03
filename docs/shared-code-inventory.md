# Web/mobile shared-code inventory

See [`docs/monorepo.md`](./monorepo.md) for the pnpm workspace ownership and command contract.

Issue #102 requires this inventory before extracting workspace packages. It is intentionally checked in so package ownership and deferrals remain reviewable. The migration keeps platform-specific adapters in `apps/web` and `apps/mobile`; extracted code is consumed through a package public entry point only.

## Decisions

| Candidate area | Decision | Owner/package | Reason and boundary |
| --- | --- | --- | --- |
| TOTP URI parsing, normalization, validation, and injected HMAC calculation | Extract now | `@rhasia-scret/client-vault-core` | Pure protocol logic with injected HMAC; no browser, Expo, React, or storage dependency. Web and native HMAC adapters remain platform-specific. |
| Authenticated crypto envelope contracts, context-bound ECDH key-wrap/identity/rotation protocols, unlock parameters, archive protocol, and injected crypto ports | Extract now | `@rhasia-scret/client-vault-core` | Client-only protocol orchestration above portable injected primitives; browser/native crypto adapters remain in their applications. Legacy envelope/key-wrap migration remains explicit, and no secret is logged or persisted by the package. |
| Encrypted account payload, workspace models/ports, and workspace lifecycle controller | Extract now | `@rhasia-scret/client-vault-core` | Shared encrypted DTO and headless workspace behavior are used by both application consumers. Reconciliation, logical cancellation, write gating, failure transitions, and key cleanup share one injected lifecycle interface; labels, keys, and plaintext remain in client memory. |
| Hosted Authenticator Account HTTP protocol | Extract now | `@rhasia-scret/client-vault-core` | Personal/Shared endpoint selection, ciphertext request construction, revision handling, strict created-account parsing, and normalized transport failure semantics are identical above `AuthenticatedTransport`; encryption and credential adapters remain platform-specific. |
| Offline encrypted bundle parsing, conditional retrieval, and snapshot ports | Extract now | `@rhasia-scret/client-vault-core` | Read-only encrypted bundle parsing plus conditional request/`304` semantics are platform-neutral; IndexedDB and native storage/crypto implementations stay in application infrastructure. |
| Secure Share Link material creation/redemption, creation sequencing, HTTP protocol, and injected workflow ports | Extract now | `@rhasia-scret/client-vault-core` | Cryptographic workflow, ciphertext-only HTTP semantics, delivery sequencing, cancellation, and temporary-buffer cleanup are above injected client crypto, delivery, and `AuthenticatedTransport` ports; navigation and sharing effects stay platform-specific. |
| Vault archive preparation/opening contracts | Extract now | `@rhasia-scret/client-vault-core` | Archive bytes are handled only in caller-controlled client memory; download/file APIs remain web/native adapters. |
| Shared-vault account permission calculation | Extract now | `@rhasia-scret/client-vault-core` | Deterministic capability policy is a named bounded-context API consumed by web and mobile; it contains no role UI or persistence. |
| Base64, protocol constants, and platform port types | Extract now | `@rhasia-scret/client-vault-core` | Small capability-owned primitives required by both clients; no generic cross-context utility package is introduced. |
| Browser crypto primitives, WebAuthn/PRF, IndexedDB, service worker, Clipboard, QR camera, and browser HTTP | Keep platform-specific | `apps/web` | These depend on browser APIs and must not enter native bundles or server targets. |
| Local Vault session owner and encrypted-record adapter | Keep platform-specific | `apps/web` Local Vault context | The client-only application seam owns one unlocked value per consuming surface, serialized mutations, replacement cleanup, lock, and teardown. Browser IndexedDB/crypto workflows remain behind injected session ports; plaintext never enters Query or persistent caches. |
| Expo SecureStore, native Argon2, native crypto, camera, clipboard, and bearer transport | Keep platform-specific | `apps/mobile` | These depend on React Native/Expo/native APIs and are injected into the extracted client workflows. |
| Prisma repositories, Next route handlers, server session/auth adapters, and server audit/retention code | Keep platform-specific | `apps/web` | Server-side application data access and authorization must not depend on client crypto/decryption or OTP runtime adapters. `src/app` contains only Next.js convention files and metadata assets; route composition consumes context-owned public entry points, including `server.ts` seams for Route Handlers. Audit owns its typed transactional append, redacted query, and retention adapters. |
| DOM-rendered web views and React Native rendered screens | Keep platform-specific | `apps/web` / `apps/mobile` | DOM and native semantics/accessibility differ. Shared headless models and ports are preferred over forced rendered-component reuse. |
| Locale identifiers, message catalogs, and next-intl provider/switcher | Keep platform-specific | `apps/web` and mobile localization adapters | Catalog values are presentation-owned; protocol/error codes remain shared and locale-independent. User content and secrets never enter catalogs. |
| Existing overlapping vault/account UI implementation candidates not listed as extracted | Defer with reason | Owning application | No second real consumer with stable props/semantics has been proven; extracting them would create a generic UI package or weaken platform accessibility. Revisit only with a web/native adapter spike and consumer tests. |

## Package contract

`packages/client-vault-core` exports all extracted behavior from `src/index.ts`. Both `apps/web` and `apps/mobile` declare a `workspace:*` dependency and import the public package entry point; they do not reach into package internals or import one another. The package has no Next.js, React, React Native, Expo, Prisma, Supabase, filesystem, or platform storage imports. Randomness, crypto primitives, transport, time, storage, download, and UI effects are injected ports.

The package boundary is covered by its own typecheck/unit test and by the web/mobile consumer suites. pnpm workspace dependency edges and the repository architecture checks keep application-to-package direction one-way.

## Sensitive-data review

The package accepts encrypted bytes and caller-owned plaintext only for immediate client-side transformation. It has no module-level cache, query integration, service-worker integration, logging, or persistence. TOTP secrets, generated OTPs, Vault keys, unlock secrets, private keys, decrypted labels, and archive key material are not package constants, message-catalog values, or CI artifacts.
