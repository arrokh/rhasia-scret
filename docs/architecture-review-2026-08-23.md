# Architecture review implementation — 2026-08-23

This document records the ownership changes implemented from the `apps/web` architecture review. It does not change the zero-knowledge, authorization, localization, retention, or client/server contracts in `CONTEXT.md` and the accepted ADRs.

## Workspace lifecycle

`WorkspaceLifecycle` in `@rhasia-scret/client-vault-core` owns reconciliation state transitions, logical cancellation, write gating, refresh-failure classification, replacement cleanup, lock cleanup, and teardown cleanup. The web Sync context supplies browser network, visibility, lock, write-policy, and workspace adapters through `useWorkspaceLifecycle`.

The online Authenticator Account provider and read-only offline shell only adapt this lifecycle to React. Workspace loading/decryption remains behind Sync infrastructure, and plaintext key/account material remains client-only.

## Vault Membership presentation

Owner Invitation, Re-invitation, Secure Share Link copying, participant revocation, Vault-wide permissions, and member overrides live in `modules/vault-membership/presentation/vault-membership-owner-panel.tsx`. Vault Management retains the Vault details shell, rename/delete lifecycle, account-management composition, and tab navigation, consuming Vault Membership through its public entry point.

## Vault Audit History

The Audit context owns:

- the typed event vocabulary and unknown-event redaction fallback;
- redacted owner query contracts and presentation;
- browser audit transport;
- one-year audit retention policy and bounded purge repository;
- the Prisma query repository; and
- a transaction-scoped append adapter used by mutation-owning contexts.

Mutation repositories append audit records inside their existing Prisma transaction. No asynchronous event bus or eventual audit queue is introduced. Other contexts do not write `vaultAuditEvent` directly.

## App Router composition

`apps/web/src/app` contains only recognized Next.js route, layout, loading, error, generated-metadata, and Route Handler convention files. Static favicon and application-icon files live under `public/assets` and are referenced explicitly by root metadata. Landing presentation, development-preview harnesses, the protected Vault page frame/context/menu, and the global stylesheet live in their owning context or shared presentation modules. App Router convention files compose these implementations through public `index.ts`, `page.ts`, `preview.ts`, or `server.ts` entry points rather than owning support modules beside a route. The complete placement contract is documented in [`docs/app-router-composition.md`](./app-router-composition.md) and enforced by architecture inventory coverage.

## Server composition seams

Every App Router API route imports context application behavior and adapter factories only from public `modules/<context>/server.ts` seams. Concrete Prisma/provider adapter selection is kept in those server modules. Routes continue to validate HTTP input, invoke use cases, enforce the existing rate-limit call sites, and map typed outcomes to HTTP responses.

## Test ownership

Domain-specific unit/component tests mirror their bounded context under `apps/web/src/tests/unit/<context>/`. Cross-context architecture inventories remain under `unit/architecture`, shell behavior under `unit/app-shell`, and shared mechanics under `unit/shared`. Contract, integration, and browser suites remain centralized by test type. Architecture coverage rejects non-convention files under `src/app`, flat unit tests, API Route Handler imports of context internals, duplicated presentation lifecycle orchestration, membership UI leakage, and direct audit persistence outside Audit.
