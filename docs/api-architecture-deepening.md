# API architecture deepening

## Status — 2026-09-21

The API extraction now implements four bounded-context deepening changes identified during the `apps/api` architecture review. These changes preserve the `/v1/**` contract and do not change the encrypted-content or client-only secret boundary.

## 1. Authenticated application access

- **Module:** `apps/api/src/shared/infrastructure/authenticated-application-request.ts`
- **Interface:** `AuthenticatedApplicationExecutor`
- **Implementation:** `createAuthenticatedApplicationExecutor`
- **Depth:** The executor owns session verification, application-user provisioning, rate-limit policy, and the stable authentication error mapping.
- **Seam:** Route handlers provide only the request, assurance, and operation policy.
- **Adapter:** `ApiRequestContext.identity` supplies the verifier and application-user repository; `ApiRequestContext.applicationRuntime.applicationRateLimitChecker()` supplies the persistence-backed limiter.
- **Leverage:** Every authenticated route receives the same invalid-credential, inactive-user, and rate-limit behavior.
- **Locality:** HTTP status mapping remains in the shared HTTP adapter while identity policy remains in the identity/application modules.

## 2. Bounded-context runtime composition

- **Module:** `apps/api/src/modules/server-composition/runtime.ts`
- **Interface:** `ApiApplicationRuntime`
- **Implementation:** Memoized, per-request repository factories.
- **Depth:** Repository construction and Prisma wiring are hidden behind named context capabilities such as `sharedVaults()`, `vaultAudit()`, and `secureShareLinks()`.
- **Seam:** Route handlers depend on a capability, not on Prisma or a module factory.
- **Adapter:** `createApiApplicationRuntime(database, bindings)` adapts the process database and bindings to the route-facing runtime.
- **Leverage:** Route composition is centralized, and each capability is instantiated at most once per request.
- **Locality:** Domain repository selection stays in the owning bounded context; the composition module only assembles adapters.

`ApiRequestContext` no longer exposes the Prisma client. It exposes the application runtime, identity runtime, bindings, and email senders needed by HTTP orchestration; the application runtime owns the authenticated rate-limit port.

## 3. Passwordless identity lifecycle

- **Module:** `apps/api/src/modules/identity/application/identity-runtime.ts`
- **Interface:** `IdentityRuntime`
- **Implementation:** `createIdentityRuntime` selects the configured authentication backend once and shares the resulting passwordless service with session verification and termination.
- **Depth:** The runtime owns the lifecycle seam across magic-link redemption, browser-session verification, refresh, revoke, and PWA handoff.
- **Seam:** HTTP routes consume `context.identity.passwordlessAuth`, `sessionVerifier`, and `sessionTerminator`; they do not reselect the backend or construct authentication adapters.
- **Adapter:** `createPasswordlessAuthServiceForRuntime` supplies a disabled safe adapter for non-passwordless backends and the Prisma-backed service for passwordless operation.
- **Leverage:** Verification and termination use the same lifecycle service instance, preventing configuration drift and duplicate backend selection.
- **Locality:** Passwordless lifecycle rules remain in identity; route modules only validate transport input and map responses.

## 4. Application User Deletion

- **Module:** `apps/api/src/modules/account-deletion/application/complete-account-deletion.ts`
- **Interface:** `CompleteAccountDeletionDependencies`
- **Implementation:** `completeAccountDeletion` coordinates committed deletion, best-effort completion-email delivery, and persisted email status.
- **Depth:** The workflow preserves the invariant that email failure cannot undo a committed account deletion.
- **Seam:** `DELETE /v1/me` supplies the authorized user, deletion plan, repository, sender, and clock; the workflow returns the receipt and delivery outcome.
- **Adapter:** The Prisma deletion repository remains responsible for atomic database deletion and receipt persistence; the HTTP handler remains responsible for origin, cookie, and response concerns.
- **Leverage:** Completion status behavior is now directly unit-tested without exercising HTTP or Prisma.
- **Locality:** Destructive deletion policy and transaction behavior remain in the account-deletion context; authentication/session cookies remain in identity and HTTP adapters.

## Verification

The focused API evidence for this change is:

```text
pnpm --filter @rhasia-scret/api lint
pnpm --filter @rhasia-scret/api typecheck
pnpm --filter @rhasia-scret/api test:unit
```

The repository completion gate remains `mise exec -- pnpm run test:full`. Production deployment, provider cutover, live SMTP/database checks, monitoring, and rollback evidence remain external release blockers; see [`release-readiness/2026-09-21.md`](release-readiness/2026-09-21.md).
