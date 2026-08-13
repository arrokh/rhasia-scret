# pnpm workspace monorepo

The repository uses pnpm workspaces as its monorepo boundary. The root `pnpm-lock.yaml` is the sole JavaScript dependency lockfile and `pnpm-workspace.yaml` includes `apps/*` and `packages/*`.

## Ownership

- `apps/web` owns the Next.js application, server routes, Prisma schema and migrations, browser adapters, web presentation, localization catalogs, and web-only tests/configuration.
- `apps/mobile` owns the Expo application, native modules, native adapters, mobile presentation, mobile localization, and mobile-only tests/configuration.
- `packages/client-vault-core` owns platform-neutral client workflows and contracts. It exposes `src/index.ts` as its public API and has no dependency on either app or on browser, React, Expo, Prisma, Supabase, filesystem, or platform-storage APIs.

Applications may depend on the shared package through `workspace:*`. They must not import the other application or reach into shared-package internals. Browser and native capabilities remain injected ports implemented by the owning app.

Server-owned web code may import only the encrypted offline-bundle parser/contracts and deterministic Shared Vault permission policy/types from `client-vault-core`. An architecture test rejects all other package symbols—including crypto, decryption, unlock, archive-opening, Secure Share, and OTP workflows—as well as default, namespace, wildcard, inline, and dynamic package imports at server boundaries.

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
pnpm run test:full:core
pnpm run test:full:web
pnpm run test:full:mobile
pnpm run test:full
```

`test:full` runs the shared package, web, and mobile full verification paths in that order. The service-specific commands remain available for focused validation.

Web deployment keeps the repository root as the Vercel project root so pnpm can resolve the shared lockfile and workspace packages; the build command filters `@rhasia-scret/web`. Configure the Vercel project to use Node.js 24.x. Workspace engine ranges accept Vercel's supported Node 24 runtime while local development and CI remain pinned to mise-managed Node.js 26.7.0. Keep the root install/build commands from `vercel.json` and leave Output Directory unset.
