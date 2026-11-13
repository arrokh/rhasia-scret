# Server-only data access until RLS hardening

> Current implementation: the Go/Echo API uses server-side pgx. The original Prisma implementation detail below is historical; the server-only data-access boundary remains in force.

The MVP accesses application tables only through the server-side API. Database/API hardening is explicitly deferred, so browsers must not access application tables directly until a tracked security migration enables RLS and supplies appropriate policies.
