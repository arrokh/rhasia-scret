# Shared TOTP Vault Agent Guide

## Domain and security

- Read `CONTEXT.md` and relevant `docs/adr/` records before changing domain behavior.
- Keep plaintext TOTP secrets, raw QR data, generated OTPs, Vault Encryption Keys, User Root Keys, Vault Unlock Secrets, and private encryption keys on authorized clients only. This includes the web browser and the native iOS/Android client; these values must not cross into server persistence, logs, analytics, or shared caches. The one-time Secure Share Link secret may enter a transient client URL fragment for delivery, but must be consumed in memory and never persisted, logged, or sent to the server.
- The server is honest-but-curious: it enforces authorization but must only persist encrypted content and permitted authorization/lifecycle metadata.
- Treat vault names, account issuer/name, and all TOTP configuration as encrypted content.
- Do not weaken encryption, authorization, audit redaction, or client/server boundaries without a new ADR.

## Architecture

- Use bounded contexts under `apps/web/src/modules/<context>/{domain,application,infrastructure,presentation}`. The Expo composition and native adapters belong under `apps/mobile`; cross-platform client workflows belong in a named `packages/*` capability package with a public entry point.
- Keep `apps/web/src/app` exclusively for recognized Next.js App Router convention files and file-based metadata assets. Move page support implementations, loaders, preview harnesses, fixtures, and styles into their owning context presentation or shared presentation module; do not add route-local `_components`, `components`, client, or helper files under `app`. Consume them through a context public entry point. Follow `docs/app-router-composition.md`.
- `apps/mobile` is the Expo SDK 57 iOS/Android composition layer. It may implement native ports and presentation, but must not import `apps/web` or browser-only APIs. It currently consumes hosted Personal/Shared Vault workflows and read-only encrypted offline snapshots; it does not implement the browser-only Local Profile/Local Vault.
- Web domain code under `apps/web/src` must not import Next.js, React, Prisma, Supabase, browser APIs, or HTTP types. Platform-neutral packages must not import either application or platform APIs.
- Cross-context access goes through each module's public API; do not reach into another module's internals. `apps/web` and `apps/mobile` may consume named shared packages but shared packages may not depend on either app.
- Keep route handlers thin: validate input, invoke an application use case, and map errors to HTTP.
- Server code must not import client crypto/decryption or OTP runtime modules.
- Use server-side Prisma for application data access owned by `apps/web`. Supabase Data API/RLS hardening is deferred; do not add browser or Supabase REST database access until that work is explicitly approved.

### Client forms and server state

- Implement interactive forms with TanStack Form. Keep field state, submission state, validation, and accessible warnings in the form model; associate errors with controls through `aria-invalid` and `aria-describedby`.
- Put TanStack Query operations in context-owned hooks under `src/modules/<context>/presentation/hooks/`. Group hooks by cohesive use case or aggregate (for example Personal Vault versus Shared Vault), use stable context-prefixed keys, and keep components free of raw query configuration.
- Presentation components must not call `fetch` directly. Context infrastructure clients own endpoint paths, request/response types, and context-specific error mapping; reuse the shared `BrowserApiClient` for identical HTTP transport and JSON behavior.
- Centralize only genuinely identical mechanics in shared classes or helpers. Keep domain language, endpoint semantics, authorization outcomes, and use-case orchestration inside the owning bounded context; do not create a cross-context god client or generic repository.
- Use TanStack Query only for permitted server state. Never place plaintext TOTP secrets, raw QR data, generated OTPs, Vault Encryption Keys, User Root Keys, Vault Unlock Secrets, private encryption keys, or decrypted Vault content in query keys, query results, mutation variables, mutation results, or mutation-function closures retained by the cache.
- Keep unlock, decryption, OTP, and passkey-recovery workflows as direct client-only operations outside TanStack Query. Do not persist the Query Client cache. Route web app content through the root `QueryProvider`, and use an isolated Query Client in web component tests. The native app does not use TanStack Query; its equivalent workflows remain in direct client state and native adapters.
- Maintain architecture tests that inventory all forms, reject direct presentation-layer `fetch`, reject TanStack Query imports outside presentation hooks/providers, and verify Query Client persistence remains disabled.

## Localization

- Read `docs/adr/0035-cookie-based-english-and-indonesian-localization.md` and `docs/i18n-implementation-plan.md` before changing user-facing copy or presentation behavior.
- Keep every production and development-preview surface complete in both Indonesian (`id`) and English (`en`), including visible copy, accessibility text, form validation, user-facing errors, dates/plurals, metadata, the web app manifest, and each read-only offline shell. Update `apps/web/messages/id.json` and `apps/web/messages/en.json` together with exact key parity for web; update `apps/mobile/src/localization.ts` with exact key parity for native. Indonesian remains the deterministic default, with the web selected by the validated cookie and mobile selected by native presentation state.
- Use `next-intl` only in `apps/web/src/i18n`, App Router composition, and web presentation layers. Native presentation uses its own mobile catalog. Domain, application, infrastructure, API, database, archive, audit, and cryptographic contracts must expose typed locale-independent values or error codes rather than localized messages.
- Do not add locale-prefixed or translated paths, infer locale from `Accept-Language`, or persist locale in Prisma, IndexedDB, TanStack Query, encrypted content, or cryptographic payloads. Locale selection remains the validated `RHSIA_LOCALE` cookie defined by ADR-0035.
- Never place user-provided Vault/account labels, TOTP configuration, OTPs, secrets, keys, Secure Share Link material, or decrypted content in message catalogs, locale state, Query caches, or service-worker caches.
- Extend catalog-parity, hard-coded-copy, architecture, contract, and browser/offline coverage with each localized surface. Preserve the exact destructive-reset token `HAPUS DATA BRANKAS` in both locales.

## Quality

- Generate Prisma migrations only with the Prisma CLI (`prisma migrate dev`); never author migration SQL by hand. Use `DATABASE_URL` for pooled runtime traffic and require `DIRECT_URL` for Prisma migrations, introspection, and administrative tooling.
- Store domain enum values as database strings. Use TypeScript unions or enums for strictness in code; do not create native PostgreSQL enums.
- Use mise-managed Node.js 24.19.0 and pnpm 11.17.0. Run `mise install && mise run setup` for a new checkout, then use pnpm for dependency and script commands. Run `pnpm run lint`, `pnpm run typecheck`, `pnpm test`, `pnpm run test:architecture`, and `pnpm run build` before declaring work complete. For native release evidence, also run `mise exec -- pnpm --dir apps/mobile run build:android-native` and `mise exec -- pnpm --dir apps/mobile run build:ios-simulator`; `pnpm run test:full` runs mobile JS verification but does not replace those native builds or real-device checks.
- Use pnpm workspaces as the monorepo boundary and the root `pnpm-lock.yaml` as the sole JavaScript dependency lockfile. Web-only code belongs under `apps/web`, mobile/native code under `apps/mobile`, and platform-neutral client workflows belong in a named `packages/*` package with a public entry point. Run `pnpm run test:full` as the final verification before merge/PR handoff; it covers lint, typecheck, unit/integration/contract tests, architecture checks, build, performance bundle checks, and browser tests.
- Before creating a commit, opening or updating a pull request, deploying, or merging any branch into `main`, run a fresh complete `pnpm run test:full` from the repository root with all required environment variables after the final code or configuration change. An agent must never merge to `main` unless this exact local gate passed; diagnose failures, fix the cause, and rerun the complete suite. Targeted tests are supplementary and never replace the full gate; report any environment-blocked phase explicitly instead of claiming the gate passed.
- Add unit tests for domain rules and architecture tests for import boundaries. Add integration, contract, and browser tests with each vertical slice.
- Preserve strict TypeScript. Avoid `any`, TODO placeholders, dead code, and compatibility shims.
- Update `CONTEXT.md` immediately when domain language is resolved. Add an ADR only for hard-to-reverse, surprising trade-offs.
