# PostgreSQL-backed application mutation rate limits

Authenticated application mutations use fixed-window operation-class budgets keyed only by the opaque Application User identifier and a non-sensitive operation identifier. PostgreSQL is the shared limiter backend. Each request atomically inserts or increments one aggregate window with `INSERT ... ON CONFLICT DO UPDATE`; the database clock selects the window and supplies the retry deadline.

Grouping alternate routes into one operation class prevents endpoint-path changes from multiplying a user's effective budget. Rate limiting runs only after Supabase session verification and Application User loading, and before request-body parsing or domain mutation. It supplements authorization, optimistic revision checks, one-time Secure Share Link semantics, and Supabase Auth's own OTP or magic-link limits.

If the PostgreSQL limiter cannot return a decision, authenticated mutations fail closed with `503 rate_limit_unavailable` and a short `Retry-After`. Exhausted budgets return `429 rate_limited` with a bounded `Retry-After`. Neither response reveals the operation, user, route context, or submitted data.

The limiter stores no request bodies, email addresses, ciphertext, Secure Share Link verifiers, credentials, or cryptographic material. Aggregate windows expire, become eligible for removal after a bounded operational-retention period, and are removed by subsequent limiter traffic. Per-process metrics aggregate only operation class and outcome in one-minute windows; they never include user identifiers or request data.
