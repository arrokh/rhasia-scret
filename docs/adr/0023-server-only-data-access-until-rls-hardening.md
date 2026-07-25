# Server-only data access until RLS hardening

The MVP accesses application tables only through server-side Prisma. Supabase Data API/RLS hardening is explicitly deferred, so clients and Supabase REST must not access application tables until a tracked security migration enables RLS and supplies appropriate policies.
