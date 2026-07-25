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

## Quality

- Generate Prisma migrations only with the Prisma CLI (`prisma migrate dev`); never author migration SQL by hand. Use `DATABASE_URL` for pooled runtime traffic and require `DIRECT_URL` for Prisma migrations, introspection, and administrative tooling.
- Store domain enum values as database strings. Use TypeScript unions or enums for strictness in code; do not create native PostgreSQL enums.
- Use mise-managed Node.js 26.5.0 and pnpm 11.17.0. Run `mise install && mise run setup` for a new checkout, then use pnpm for dependency and script commands. Run `pnpm run lint`, `pnpm run typecheck`, `pnpm test`, `pnpm run test:architecture`, and `pnpm run build` before declaring work complete.
- Add unit tests for domain rules and architecture tests for import boundaries. Add integration, contract, and browser tests with each vertical slice.
- Preserve strict TypeScript. Avoid `any`, TODO placeholders, dead code, and compatibility shims.
- Update `CONTEXT.md` immediately when domain language is resolved. Add an ADR only for hard-to-reverse, surprising trade-offs.
