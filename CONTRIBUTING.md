# Contributing to rhasia-scret

Thank you for helping improve rhasia-scret. Read the [Code of Conduct](CODE_OF_CONDUCT.md),
[security policy](SECURITY.md), [DCO](DCO.md), and relevant architecture
decisions before opening a change.

## Before you start

1. Use Node.js `24.19.0` and pnpm `11.17.0` through mise.
2. Read [`CONTEXT.md`](CONTEXT.md), [`AGENTS.md`](AGENTS.md), the relevant
   `docs/adr/` records, and the [documentation index](docs/README.md).
3. Use synthetic data only. Never commit Vault material, credentials, OTPs,
   QR data, private keys, provider tokens, database URLs, or Secure Share Link
   fragments.
4. Search existing issues and pull requests before starting substantial work.
   Small documentation fixes may go directly to a pull request.

## Architecture boundaries

- Keep web bounded contexts under
  `apps/web/src/modules/<context>/{domain,application,infrastructure,presentation}`.
- Keep `apps/web/src/app` limited to Next.js App Router convention files and
  thin composition.
- Keep `apps/mobile` as the Expo composition layer. It must not import `apps/web`
  or browser-only APIs.
- Put cross-platform client workflows in `packages/*` with a public entry point.
- Keep domain and application code free from React, Next.js, Prisma, Supabase,
  browser APIs, HTTP types, and localization libraries.
- Cross bounded-context access must use a public module API; do not reach into
  another context's internals.
- Route handlers validate input, invoke an application use case, and map
  errors to HTTP. Server code must not import client crypto, decryption, or OTP
  runtime modules.

## Security-sensitive review

Plaintext TOTP secrets, raw QR data, generated OTPs, Vault Encryption Keys,
User Root Keys, Vault Unlock Secrets, private encryption keys, archive keys,
Secure Share Link material, and decrypted Vault content remain on authorized
clients only. Do not place them in server persistence, logs, analytics, shared
caches, query keys/results, mutation variables, or fixtures.

Changes to crypto, authentication, authorization, audit redaction, retention,
recovery, offline storage, analytics sanitization, or provider boundaries need
focused tests and an ADR when the decision is hard to reverse or surprising.
Security reports must use the private process in [`SECURITY.md`](SECURITY.md),
not a public issue.

## Localization and presentation

Every user-facing web and native surface must remain complete in Indonesian
(`id`) and English (`en`) with exact catalog key parity. Update
`apps/web/messages/id.json`, `apps/web/messages/en.json`, and
`apps/mobile/src/localization.ts` together when the surface applies to those
clients. Do not localize domain or infrastructure contracts, routes, APIs,
encrypted content, or user-provided Vault/account labels.

## Database and migration rules

- Use `DATABASE_URL` for pooled runtime traffic and require `DIRECT_URL` for
  Prisma migrations, introspection, and administrative tooling.
- Generate Prisma migrations only with `prisma migrate dev`; never author
  migration SQL by hand.
- Store domain enum values as database strings and keep strict TypeScript
  unions/enums in code.
- Add authorization, revision, retention, and redaction tests for affected
  data paths.

## Local verification

From the repository root, run the focused checks relevant to the change and,
before merge or PR handoff, the complete gate:

```bash
mise install
mise run setup
mise exec -- pnpm install --frozen-lockfile
mise exec -- pnpm run lint
mise exec -- pnpm run typecheck
mise exec -- pnpm test
mise exec -- pnpm run test:architecture
mise exec -- pnpm run build
mise exec -- pnpm run test:full
```

`test:full` includes the web, mobile, shared client, browser, build, policy,
and performance checks. If a phase needs unavailable provider credentials,
native toolchains, browsers, or database services, report the exact blocked
phase and output rather than claiming the gate passed.

## Pull requests

- Use a focused branch and describe the issue, behavior, security impact, and
  verification evidence.
- Add or update unit, integration, contract, architecture, browser, or native
  tests with each vertical change.
- Update `CONTEXT.md` when domain language is resolved and add an ADR for a
  hard-to-reverse trade-off.
- Preserve the PR checklist and request review from the repository owners.
- Sign every commit with the DCO trailer (`git commit -s`).
- Do not merge until required CI checks pass and the maintainer explicitly
  approves the release risk.

The [governance document](GOVERNANCE.md) explains triage, escalation,
vulnerability embargo, and release approval responsibilities.
