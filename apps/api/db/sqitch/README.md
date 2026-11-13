# Sqitch database changes

The Sqitch project is configured in `apps/api/sqitch.conf`; its plan and SQL scripts live here. Targets and credentials are supplied at run time. Never commit database URLs or credentials to the project configuration or plan.

## Immutable `init` baseline

`init` is the cutover baseline for the current application schema. Its deploy DDL comes from a schema-only PostgreSQL 16.15 dump of a fresh, synthetic database after the checked-in Prisma migration history and its staged passwordless migration procedure were applied. The dump contains no application rows and excludes `_prisma_migrations`; it preserves the physical column order created by historical `ALTER TABLE ... ADD COLUMN` changes, which differs from Prisma model field order in several tables.

The baseline was checked against the migrated schema on disposable PostgreSQL 16.15 databases:

- Both schema-only `pg_dump` outputs matched after removing PostgreSQL's per-dump random `\restrict` tokens. The comparison covered 21 application tables, 49 indexes, and 38 constraints; it excluded only Sqitch registry and Prisma migration metadata.
- `sqitch deploy --verify` and `sqitch verify` passed on a fresh database.
- On a separate database created with the historical Prisma path, `sqitch deploy --log-only` registered the baseline without running its DDL, and `sqitch verify` passed. A synthetic sentinel application-user row retained the same ID, email, and status. The before/after application-schema dumps matched.
- The disposable Compose projects, PostgreSQL containers, volumes, and networks were removed and their absence verified. The historical Prisma chain is now archived under `apps/api/prisma/archive/migrations/` with no active Prisma migration path. No persistent or production database was accessed.

While `init` is the latest deployed API change, its verify script checks the closed-world application-schema fingerprint: tables and row-security flags, relative column order, types, nullability, defaults, constraints, indexes, extensions, standalone types, sequences, views, routines, user triggers, and row-security policies. It excludes `_prisma_migrations` and the separate Sqitch registry. Column ordinals use `row_number()` so PostgreSQL's internal `attnum` gaps from historical `DROP COLUMN` operations do not create a false mismatch while actual column order remains checked.

Sqitch runs every deployed verify script against the current database. Therefore, once a later schema change exists, the immutable `init` verifier defers its exact-snapshot check; each later change's verify script must check the complete current application-schema fingerprint and reject untracked objects. Future schema changes belong in new Sqitch changes; do not edit the deployed baseline.

The baseline cannot safely be reverted after application data exists. `revert/init.sql` always fails closed. Never use it to roll back application data; use a separately reviewed forward fix or approved restore procedure. Disposable test databases are cleaned up by deleting only their run-owned Compose project and volume.

## Fresh install and existing-schema adoption

For a fresh database, deploy the baseline and verify it:

```sh
sqitch deploy --verify --target "$SQITCH_TARGET"
sqitch verify --target "$SQITCH_TARGET"
```

For an already-provisioned database, first perform and review a read-only schema comparison against the baseline. Only with explicit approval for that exact database may an operator register the already-present baseline:

```sh
sqitch deploy --log-only --to-change init --target "$SQITCH_TARGET"
sqitch verify --target "$SQITCH_TARGET"
```

`--log-only` creates Sqitch registry/history records but does not run the baseline DDL and does not prove schema equivalence. Do not register `init` in production as part of the Go runtime cutover. The disposable Testcontainer wrapper materializes `test-fixtures/legacy-prisma-schema.sql`, compares it with the fresh Sqitch schema, then exercises log-only adoption and sentinel preservation; it never replays archived Prisma scripts. Historical Prisma migrations and staged scripts are archived under `apps/api/prisma/archive/`; keep them and `_prisma_migrations` as read-only evidence, never as an active deploy path.

## Disposable local test stack

`docker-compose.sqitch-test.yml` uses PostgreSQL 16, loopback-only published access, one project-owned local data volume, and the pinned `sqitch/sqitch:v1.6.1.1` image. Create a fresh run ID and pass the repository's database scope verifier before any database operation, as required by `AGENTS.md`. Use only synthetic fixtures. After the test, run Compose teardown with `--volumes --remove-orphans`, then verify the run-owned container, volume, and network are absent. Never reuse a run ID after teardown.
