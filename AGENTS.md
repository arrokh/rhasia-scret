# Shared TOTP Vault Agent Guide

## Domain and security

- Read `CONTEXT.md` and relevant `docs/adr/` records before changing domain behavior.
- Keep plaintext TOTP secrets, raw QR data, generated OTPs, Vault Encryption Keys, User Root Keys, Vault Unlock Secrets, and private encryption keys on the client only.
- The server is honest-but-curious: it enforces authorization but must only persist encrypted content and permitted authorization/lifecycle metadata.
- Treat vault names, account issuer/name, and all TOTP configuration as encrypted content.
- Do not weaken encryption, authorization, audit redaction, or client/server boundaries without a new ADR.

## Architecture

- Use bounded contexts under `src/modules/<context>/{domain,application,infrastructure,presentation}`.
- Domain code must not import Next.js, React, Prisma, Supabase, browser APIs, or HTTP types.
- Cross-context access goes through each module's public API; do not reach into another module's internals.
- Keep route handlers thin: validate input, invoke an application use case, and map errors to HTTP.
- Server code must not import client crypto/decryption or OTP runtime modules.
- Use server-side Prisma for application data access. Supabase Data API/RLS hardening is deferred; do not add browser or Supabase REST database access until that work is explicitly approved.

### Client forms and server state

- Implement interactive forms with TanStack Form. Keep field state, submission state, validation, and accessible warnings in the form model; associate errors with controls through `aria-invalid` and `aria-describedby`.
- Put TanStack Query operations in context-owned hooks under `src/modules/<context>/presentation/hooks/`. Group hooks by cohesive use case or aggregate (for example Personal Vault versus Shared Vault), use stable context-prefixed keys, and keep components free of raw query configuration.
- Presentation components must not call `fetch` directly. Context infrastructure clients own endpoint paths, request/response types, and context-specific error mapping; reuse the shared `BrowserApiClient` for identical HTTP transport and JSON behavior.
- Centralize only genuinely identical mechanics in shared classes or helpers. Keep domain language, endpoint semantics, authorization outcomes, and use-case orchestration inside the owning bounded context; do not create a cross-context god client or generic repository.
- Use TanStack Query only for permitted server state. Never place plaintext TOTP secrets, raw QR data, generated OTPs, Vault Encryption Keys, User Root Keys, Vault Unlock Secrets, private encryption keys, or decrypted Vault content in query keys, query results, mutation variables, mutation results, or mutation-function closures retained by the cache.
- Keep unlock, decryption, OTP, and passkey-recovery workflows as direct client-only operations outside TanStack Query. Do not persist the Query Client cache. Route all app content through the root `QueryProvider`, and use an isolated Query Client in component tests.
- Maintain architecture tests that inventory all forms, reject direct presentation-layer `fetch`, reject TanStack Query imports outside presentation hooks/providers, and verify Query Client persistence remains disabled.

## Localization

- Read `docs/adr/0035-cookie-based-english-and-indonesian-localization.md` and `docs/i18n-implementation-plan.md` before changing user-facing copy or presentation behavior.
- Keep every production and development-preview surface complete in both Indonesian (`id`) and English (`en`), including visible copy, accessibility text, form validation, user-facing errors, dates/plurals, metadata, the web app manifest, and the read-only offline shell. Update `messages/id.json` and `messages/en.json` together with exact key parity; Indonesian remains the no-cookie default.
- Use `next-intl` only in `src/i18n`, App Router composition, and presentation layers. Domain, application, infrastructure, API, database, archive, audit, and cryptographic contracts must expose typed locale-independent values or error codes rather than localized messages.
- Do not add locale-prefixed or translated paths, infer locale from `Accept-Language`, or persist locale in Prisma, IndexedDB, TanStack Query, encrypted content, or cryptographic payloads. Locale selection remains the validated `RHSIA_LOCALE` cookie defined by ADR-0035.
- Never place user-provided Vault/account labels, TOTP configuration, OTPs, secrets, keys, Secure Share Link material, or decrypted content in message catalogs, locale state, Query caches, or service-worker caches.
- Extend catalog-parity, hard-coded-copy, architecture, contract, and browser/offline coverage with each localized surface. Preserve the exact destructive-reset token `HAPUS DATA BRANKAS` in both locales.

## Quality

- Generate Prisma migrations only with the Prisma CLI (`prisma migrate dev`); never author migration SQL by hand. Use `DATABASE_URL` for pooled runtime traffic and require `DIRECT_URL` for Prisma migrations, introspection, and administrative tooling.
- Store domain enum values as database strings. Use TypeScript unions or enums for strictness in code; do not create native PostgreSQL enums.
- Use mise-managed Node.js 26.5.0 and pnpm 11.17.0. Run `mise install && mise run setup` for a new checkout, then use pnpm for dependency and script commands. Run `pnpm run lint`, `pnpm run typecheck`, `pnpm test`, `pnpm run test:architecture`, and `pnpm run build` before declaring work complete.
- Run `pnpm run test:full` as the final verification before merge/PR handoff (this includes all local verification surfaces and browser suites). `test:full` is equivalent to `pnpm run ci:local` and covers lint, typecheck, unit/integration/contract tests, architecture checks, build, performance bundle checks, and browser tests.
- Add unit tests for domain rules and architecture tests for import boundaries. Add integration, contract, and browser tests with each vertical slice.
- Preserve strict TypeScript. Avoid `any`, TODO placeholders, dead code, and compatibility shims.
- Update `CONTEXT.md` immediately when domain language is resolved. Add an ADR only for hard-to-reverse, surprising trade-offs.
