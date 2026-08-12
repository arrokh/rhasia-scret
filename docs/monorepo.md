# pnpm workspace monorepo

The repository uses pnpm workspaces as its monorepo boundary. The root `pnpm-lock.yaml` is the sole JavaScript dependency lockfile and `pnpm-workspace.yaml` includes `apps/*` and `packages/*`.

## Ownership

- `apps/web` owns the Next.js application, server routes, Prisma schema and migrations, browser adapters, web presentation, localization catalogs, and web-only tests/configuration.
- `apps/mobile` owns the Expo application, native modules, native adapters, mobile presentation, mobile localization, and mobile-only tests/configuration.
- `packages/client-vault-core` owns platform-neutral client workflows and contracts. It exposes `src/index.ts` as its public API and has no dependency on either app or on browser, React, Expo, Prisma, Supabase, filesystem, or platform-storage APIs.

Applications may depend on the shared package through `workspace:*`. They must not import the other application or reach into shared-package internals. Browser and native capabilities remain injected ports implemented by the owning app.

## Commands

```bash
pnpm install --frozen-lockfile
pnpm --filter @rhasia-scret/web dev
pnpm --dir apps/mobile start
pnpm run lint
pnpm run typecheck
pnpm test
pnpm run test:architecture
pnpm run build
pnpm run test:full
```

Web deployment keeps the repository root as the Vercel project root so pnpm can resolve the shared lockfile and workspace packages; the build command filters `@rhasia-scret/web`.
