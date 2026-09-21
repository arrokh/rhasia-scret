# pnpm workspace monorepo

The repository uses pnpm workspaces as its monorepo boundary. The root `pnpm-lock.yaml` is the sole JavaScript dependency lockfile and `pnpm-workspace.yaml` includes `apps/*` and `packages/*`.

## Ownership

- `apps/api` owns the standalone Hono service, canonical `/v1/**` routes, server application modules, Prisma schema/migrations, persistence, email/auth adapters, retention scheduling, and API tests/configuration. Bun is the primary runtime; Node.js and Vercel adapters share the same composition.
- `apps/web` owns the Next.js presentation application, same-origin `/api/v1/**` proxy, browser adapters, web presentation, localization catalogs, SSR API gateway, and web-only tests/configuration. It has no database or backend-module ownership.
- `apps/mobile` owns the Expo SDK 57 application, generated-native configuration, repository-owned native modules, native adapters, mobile presentation, mobile localization, and mobile-only tests/configuration. It consumes hosted Personal/Shared Vault workflows and read-only encrypted offline snapshots, not the browser-only Local Profile/Local Vault.
- `packages/client-vault-core` owns platform-neutral client workflows and contracts. It exposes `src/index.ts` as its public API and has no dependency on either app or on browser, React, Expo, Prisma, filesystem, or platform-storage APIs.

Applications may depend on the shared package through `workspace:*`. They must not import the other application or reach into shared-package internals. Browser and native capabilities remain injected ports implemented by the owning app.

Server-owned web code may import only the encrypted offline-bundle parser/contracts and deterministic Shared Vault permission policy/types from `client-vault-core`. An architecture test rejects all other package symbols—including crypto, decryption, unlock, archive-opening, Secure Share, and OTP workflows—as well as default, namespace, wildcard, inline, and dynamic package imports at server boundaries.

## Commands

```bash
pnpm install --frozen-lockfile
pnpm dev                         # starts local Bun API, waits for health, then web
pnpm run dev:api                 # local Bun API only
pnpm run dev:web                 # web only
pnpm --filter @rhasia-scret/api dev:node  # generic Node.js local runtime
pnpm --dir apps/mobile start
pnpm run lint
pnpm run typecheck
pnpm test
pnpm run test:hosted
pnpm run test:container
pnpm run test:parallel
pnpm run test:architecture
pnpm run build
pnpm run test:full:core
pnpm run test:full:web
pnpm run test:full:mobile
pnpm run test:full
pnpm run test:full:hosted
pnpm run test:unit:api
pnpm --filter @rhasia-scret/api test:integration
pnpm run test:integration:container
pnpm run test:full:container
```

`test` and `test:full` use disposable database wrappers locally; their `:hosted` commands are the underlying commands for an already-provisioned database. `test` runs the shared package, API, client-safe API packages, web, and mobile tests; `test:full` runs their full verification paths concurrently because they use isolated test/build outputs. Locally, the wrappers start a disposable PostgreSQL 16 container and route all database-backed API/browser checks to that container; they never use the development/local database. In CI, the wrappers select the job-scoped PostgreSQL service instead. `test:hosted` and `test:full:hosted` are used by CI. The API test runner performs one bounded PostgreSQL connectivity preflight: when a hosted/local `DATABASE_URL` is unavailable, database integration tests are skipped while unit/non-database tests still run; CI and `REQUIRE_DATABASE_INTEGRATION=1` fail fast instead of hiding missing integration coverage. Use `pnpm --filter @rhasia-scret/api test:integration` after providing an already-approved test schema. The hosted runner never migrates or modifies the database. The container commands create their own disposable PostgreSQL 16 container, override both database URLs with that container's mapped endpoint, apply the checked-in migrations automatically through the staged passwordless migration workflow, and remove the container afterward. They never use the development/local database, so no migration environment variable is needed. The mobile path includes JavaScript bundles and Expo Doctor but does not compile generated native projects, run Android instrumentation, or prove real-device behavior; use `docs/mobile-release-configuration.md` for those release checks. The service-specific commands remain available for focused validation. `test:parallel` runs the normal package test suites concurrently without changing the deterministic sequential `test` command.

Playwright projects use isolated browser contexts. Smoke tests use file-level parallelism by default, bounded to three local workers and one worker per CI suite/browser matrix job, while E2E and PWA tests use test-level parallelism where their isolated scenarios support it. Set `PLAYWRIGHT_FULLY_PARALLEL=1` to opt the smoke suite into test-level parallelism on capable environments; use `PLAYWRIGHT_FULLY_PARALLEL=0` to force file-level sequencing when diagnosing shared-resource failures. Override worker capacity for local or CI environments with `PLAYWRIGHT_WORKERS=50%` (or a positive integer). Browser E2E data uses browser/scenario-specific synthetic, non-PII identities so concurrent workers do not share mutable Vault fixtures; never use user-provided account data.

GitHub Actions runs change detection, repository policy, affected core/web/mobile checks, two Chromium development browser matrix cells, and production PWA/navigation checks independently on pushes to `main` and pull requests targeting `main`. Firefox and WebKit are commented out of hosted CI and are not part of the required support signal. Standard CI jobs have an eight-minute hard timeout; the combined production PWA and navigation performance job has a twelve-minute ceiling because it runs two browser stages after cold setup. Job-scoped concurrency cancels only superseded work in the same check family. See [browser test runtime](browser-test-runtime.md) for the measured bottlenecks and coverage-preserving distribution. The CI quality/browser jobs also run on pull requests targeting `main`, and their checks are required for merging. The formatting check runs on pull requests and pushes to `main`; CodeQL, dependency review, and secret scanning provide the remaining fork-safe pull-request checks. These workflows use only checked-in synthetic values and receive no provider, deployment, signing, or database secrets. This hosted signal does not replace local evidence: the merging agent must run a fresh successful `pnpm run test:full` from the repository root after the final code or configuration change and before merging into `main`.

Web deployment keeps the repository root as the Vercel project root so pnpm can resolve the shared lockfile and workspace packages. Vercel installs only `@rhasia-scret/web` and its workspace dependencies, then runs the root `pnpm build` command from `vercel.json`; leave Output Directory unset. Vercel requires Node.js `24.x` in the root and web package engine declarations; the local mise and GitHub Actions toolchain is pinned to Node.js 24.19.0, while shared packages declare compatibility with Node.js 24. The web build has no Prisma generation or database dependency. Both Vercel projects enable Git deployments only for `main`; their `ignoreCommand` values use `tools/vercel-ignore.mjs` to compare the previous and current commits and skip the project when neither its app nor a transitive workspace dependency changed. Changes to install metadata and the ignore/configuration contract fail open and rebuild the affected service. Deploy the API separately as the Node.js Vercel project configured by `apps/api/vercel.json`, and use the API's Bun adapter for the documented self-hosted Compose deployment. Generic Node.js hosting runs the production `apps/api/dist/node.js` entrypoint together with every sibling route/chunk file in `apps/api/dist/`; copying only the entrypoint breaks dynamic route imports. Database migrations and provider-neutral backfills remain explicit API-owned operations and are not run by Vercel function startup or any request path. GitHub Actions runs the quality and browser checks on pushes to `main` and pull requests targeting `main`; pull-request security checks remain in their dedicated workflows.
