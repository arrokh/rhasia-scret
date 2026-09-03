# Authenticated application mutation rate limiting

## Scope

Every state-changing route under `apps/web/src/app/api/` has an explicit operation-class assignment in `authenticated-mutation-rate-limit-inventory.ts`; the corresponding budgets live in `application-rate-limit-policy.ts`. The only exclusions are the machine-authenticated retention cron and Supabase-owned authentication session lifecycle (callback exchange and idempotent logout), none of which has an authenticated Application User. Supabase email OTP and magic-link authentication remains governed by Supabase Auth and is intentionally not duplicated by the application limiter.

Budgets are shared by authenticated Application User and operation class, so alternate routes for the same use case cannot multiply a budget:

| Operation class | Limit | Window |
| --- | ---: | ---: |
| Account mutation | 120 | 60 seconds |
| Vault mutation | 30 | 60 seconds |
| Membership / Secure Share Link mutation | 30 | 60 seconds |
| Audit access event | 120 | 60 seconds |
| Key material registration, rewrap, or rotation | 10 | 5 minutes |
| Passkey recovery authentication | 30 | 5 minutes |
| Passkey recovery enrollment or removal | 10 | 10 minutes |
| Destructive mutation | 5 | 1 hour |
| Encrypted archive import | 10 | 1 hour |

Rate limiting happens after authentication and active-user checks but before body parsing, authorization-sensitive repository work, or mutation. It does not replace owner/member authorization, Account Revision checks, one-time link consumption, or any domain conflict.

Authenticated reader and mutation Route Handlers enter through one route-facing authentication adapter, which delegates to the HTTP-neutral server-composition application seam. Each mutation supplies its explicit operation class and assurance requirement; the seam keeps `allowed`, `limited`, and `unavailable` decisions typed until the adapter maps them to HTTP. Read-only execution cannot consume a mutation budget, and Route Handlers retain their use-case-specific validation and outcome mapping.

## Responses

An exhausted budget returns:

- HTTP `429`
- `{"error":"rate_limited"}`
- `Retry-After` containing bounded whole seconds
- `Cache-Control: no-store`

No user, operation, request context, or submitted data appears in the response. Existing authorization and domain responses remain unchanged and distinguishable.

If PostgreSQL cannot make a limiter decision, the mutation fails closed with HTTP `503`, `{"error":"rate_limit_unavailable"}`, `Retry-After: 5`, and `Cache-Control: no-store`. Reads and Supabase authentication attempts are unaffected.

## Production deployment and operation

1. Apply Prisma migration `20260726193513_authenticated_application_rate_limits` through the direct administrative connection before deploying application code. Runtime limiter traffic uses the normal pooled `DATABASE_URL`; migrations require `DIRECT_URL`.
2. Keep application instances pointed at the same PostgreSQL database. Atomic upserts and the database clock provide cross-instance concurrency safety without relying on process memory or client-supplied headers.
3. Treat `rate_limit_unavailable` as a database/backend health signal. Restore database access rather than bypassing or changing the fail-closed policy during an incident.
4. Aggregate operational logs use event `application_rate_limit_metrics` at most once per warm application process per minute and contain only operation/outcome counters. Never add user identifiers, email addresses, route bodies, ciphertext, link material, credentials, or keys.
5. The `application_rate_limit_windows` table makes aggregate windows eligible for deletion 24 hours after expiry; subsequent limiter transactions remove up to 1,000 eligible rows at a time through the indexed expiry column. `request_count` saturates at `limit + 1`, bounding per-window counters.

The checked-in policy table is production configuration. Change a budget through a reviewed code change with corresponding tests and documentation rather than ad hoc environment overrides that could differ between instances.
