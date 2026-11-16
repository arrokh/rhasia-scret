# Archived Prisma migration history

**Status:** Historical evidence only. No file here is an authorized or supported schema-migration entry point; do not run these scripts.

- `migrations/` retains the former Prisma migration chain for schema provenance and compatibility research.
- `passwordless-transition/` retains the former staged migration runner, preflight/seed/verification helpers, and related tooling.

Do not run or restore these files as a deployment path. Sqitch is the sole schema-migration authority. The active Prisma schema, config, CLI, and client have been retired; no TypeScript API parity oracle or Prisma schema/client checks remain. These archive files are not part of the Go runtime, Docker runtime image, or Vercel functions.

Any future use of these historical files requires a separately reviewed migration plan and explicit authorization for the exact database target. Never replay this history against a persistent database.
