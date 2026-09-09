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
# The Prisma CLI is included in the web package's production dependencies
# because the migration container invokes it at runtime.
FROM source AS migration-bundle

RUN --mount=type=cache,id=rhasia-scret-pnpm,target=/pnpm/store \
  pnpm deploy --legacy --config.allowUnusedPatches=true \
    --filter @rhasia-scret/web --prod /migration

FROM base AS migration

ARG COMMIT_SHA
LABEL org.opencontainers.image.revision="${COMMIT_SHA}"

WORKDIR /app

COPY --from=migration-bundle /migration ./

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
