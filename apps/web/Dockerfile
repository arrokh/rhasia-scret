# syntax=docker/dockerfile:1

# Build from the repository root. The Compose file keeps the root as the
# context because the workspace lockfile, patches, and shared package are
# required for a reproducible web build.
ARG COMMIT_SHA=unknown
FROM node:24.19.0-bookworm-slim AS base

ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}
ENV NEXT_TELEMETRY_DISABLED=1

RUN apt-get update \
  && apt-get install --no-install-recommends -y ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && corepack prepare pnpm@11.17.0 --activate \
  && pnpm config set store-dir /pnpm/store

WORKDIR /workspace

FROM base AS dependencies

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches patches
COPY apps/web/package.json apps/web/package.json
COPY packages/client-vault-core/package.json packages/client-vault-core/package.json

RUN --mount=type=cache,id=rhasia-scret-pnpm,target=/pnpm/store \
  pnpm install --frozen-lockfile --filter @rhasia-scret/web...

FROM dependencies AS source

# Next page-data initialization imports the Prisma client during the build.
# These values are build-only placeholders and never reach the runtime image.
ENV DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build?schema=public
ENV DIRECT_URL=postgresql://build:build@127.0.0.1:5432/build?schema=public
ENV SELF_HOSTED_DOCKER_BUILD=1

COPY apps/web apps/web
COPY packages/client-vault-core packages/client-vault-core

FROM source AS build

RUN pnpm --filter @rhasia-scret/web build

# Create a production-only package bundle for the one-shot migration service.
# Start from dependency metadata rather than source so unrelated web/client
# changes do not invalidate the migration dependency cache.
FROM dependencies AS migration-bundle

RUN --mount=type=cache,id=rhasia-scret-pnpm,target=/pnpm/store \
  pnpm deploy --legacy --config.allowUnusedPatches=true \
    --filter @rhasia-scret/web --prod /migration

FROM base AS migration

ENV HOME=/home/node
ENV NODE_ENV=production

WORKDIR /app

COPY --from=migration-bundle --chown=node:node /migration ./

# The migration image intentionally contains only the Prisma configuration,
# schema, migrations, and scripts required by the staged migration runner.
COPY --chown=node:node apps/web/prisma.config.ts ./prisma.config.ts
COPY --chown=node:node apps/web/prisma/schema.prisma ./prisma/schema.prisma
COPY --chown=node:node apps/web/prisma/migrations ./prisma/migrations
COPY --chown=node:node apps/web/scripts/admin-prisma-client.ts \
  apps/web/scripts/deploy-passwordless-migrations.ts \
  apps/web/scripts/load-workspace-environment.ts \
  apps/web/scripts/preflight-passwordless-migration.ts \
  apps/web/scripts/seed-passwordless-identities.ts \
  apps/web/scripts/verify-passwordless-migration.ts \
  ./scripts/

# The staged migration runner performs a bounded metadata query before invoking
# Prisma Migrate, so the deployed migration image needs a generated client.
USER node
RUN DIRECT_URL=postgresql://build:build@127.0.0.1:5432/build?schema=public node_modules/.bin/prisma generate

# Keep the revision metadata separate from the expensive migration layers so a
# new commit SHA does not force the dependency copy or Prisma generation again.
ARG COMMIT_SHA
LABEL org.opencontainers.image.revision="${COMMIT_SHA}"

FROM node:24.19.0-bookworm-slim AS runtime

ARG COMMIT_SHA
LABEL org.opencontainers.image.revision="${COMMIT_SHA}"

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

WORKDIR /app

RUN apt-get update \
  && apt-get install --no-install-recommends -y ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs \
  && rm -rf /usr/local/lib/node_modules/npm \
  && rm -f /usr/local/bin/npm /usr/local/bin/npx

COPY --from=build --chown=nextjs:nodejs /workspace/apps/web/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /workspace/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=nextjs:nodejs /workspace/apps/web/public ./apps/web/public
COPY --chown=nextjs:nodejs docker/retention-purge.mjs /usr/local/bin/retention-purge.mjs

USER nextjs

WORKDIR /app/apps/web

EXPOSE 3000

CMD ["node", "server.js"]
