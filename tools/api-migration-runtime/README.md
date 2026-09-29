# API migration runtime dependencies

This private workspace package is the dependency manifest for the self-hosted
migration image only. Keep runtime dependencies limited to the Prisma CLI,
PostgreSQL adapter/client, and `dotenv`; `esbuild` is build-only and bundles the
migration TypeScript entry points to JavaScript before the runtime image is
assembled. The Docker build deploys this package rather than the API server's
production dependency graph.

The scripts, Prisma schema, and migration history remain owned by
`apps/api`. The runtime image is PostgreSQL-specific: it retains only PostgreSQL
Prisma query-compiler assets and removes Prisma's unused optional TypeScript/React
peers and PGlite development server. Keep those prunes aligned with the schema's
PostgreSQL datasource and validate the Prisma CLI, schema engine, generated
client, and staged migration workflow whenever dependencies or the schema
change. The image must continue to run staged preflight, identity seed, staged
verification, guarded cleanup, and final verification before deployment.
