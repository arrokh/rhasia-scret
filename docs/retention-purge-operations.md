# Retention purge operations

## Production execution

Vercel Cron invokes `GET /api/internal/retention-purge` every day at 03:00 UTC, as configured in `vercel.json`. Configure `CRON_SECRET` in every production environment with at least 32 random bytes. Vercel sends it as `Authorization: Bearer <CRON_SECRET>`; the route fails closed when the secret is absent, too short, or incorrect.

The job uses server-side Prisma only. Each run drains at most 10 batches of 100 records for each category:

1. expired soft-deleted Authenticator Accounts;
2. expired Shared Vaults and their encrypted accounts, memberships, and invitations; and
3. expired retained Vault Audit events.

Account and Vault selection uses PostgreSQL row locks with `SKIP LOCKED`, so concurrent workers do not process the same record. Deadline predicates remain part of the atomic delete. A restore that commits first clears the purge deadline and cannot then be deleted; if purge commits first, restore reports that the record is unavailable. Repeated or overlapping runs are safe and idempotent.

## Retention behavior

- Authenticator Accounts are eligible at `purgeAfter`, exactly 30 days after soft deletion.
- Shared Vault content and lifecycle rows are eligible at `purgeAfter`, exactly 30 days after deletion.
- For records soft-deleted before explicit deadlines were introduced, cleanup derives the same 30-day deadline from `deletedAt`; pre-deadline restoration remains available.
- Before the Vault row is removed, audit events are detached from encrypted Vault content and retain only the opaque Vault ID, owner ID, actor ID, event type, optional opaque target ID, timestamps, and actor relation needed by the existing owner-only view.
- Audit events are eligible one calendar year after Vault deletion. Restoring a Vault within 30 days clears their audit purge deadline; a later deletion starts a new one-year period.
- Cleanup never selects, decrypts, returns, or logs encrypted names, encrypted account payloads, key packages, TOTP configuration, OTPs, or plaintext Vault content.

## Observability and recovery

Successful logs use the event `retention_purge_completed` and contain only:

- an opaque job ID;
- purged opaque IDs and counts for accounts, Vaults, and audit events; and
- one backlog flag per category.

Failures use `retention_purge_failed` with only the opaque job ID. Raw database errors are deliberately excluded from production logs and responses because they may contain query parameters. A non-zero backlog flag means the bounded run reached its work limit; the next scheduled run safely continues. Persistent backlog or repeated failures should alert the operator to inspect database availability and job duration without querying encrypted payload columns.

For an authorized manual retry, invoke the same endpoint with the production `CRON_SECRET`. Never place the secret in shell history, tickets, logs, or source control. A retry requires no rollback or deduplication step.
