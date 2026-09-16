# syntax=docker/dockerfile:1

ARG COMMIT_SHA=unknown
FROM node:24.19.0-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}
RUN apt-get update && apt-get install --no-install-recommends -y ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && corepack prepare pnpm@11.17.0 --activate \
  && pnpm config set store-dir /pnpm/store
WORKDIR /workspace

FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches patches
COPY apps/api/package.json apps/api/package.json
COPY packages/api-contract/package.json packages/api-contract/package.json
COPY packages/client-vault-core/package.json packages/client-vault-core/package.json
RUN --mount=type=cache,id=rhasia-scret-pnpm,target=/pnpm/store pnpm install --frozen-lockfile --filter @rhasia-scret/api...

FROM dependencies AS source
COPY apps/api apps/api
COPY packages/api-contract packages/api-contract
COPY packages/client-vault-core packages/client-vault-core
# Prisma 7 loads prisma.config.ts even for generation; this is never a runtime or migration URL.
ENV DIRECT_URL=postgresql://localhost:5432/rhasia_scret_generate
RUN pnpm --filter @rhasia-scret/api prisma:generate

FROM source AS build
RUN pnpm --filter @rhasia-scret/api build

FROM source AS migration
WORKDIR /workspace/apps/api
ENV NODE_ENV=production
ARG COMMIT_SHA
LABEL org.opencontainers.image.revision="${COMMIT_SHA}"
CMD ["node_modules/.bin/tsx", "scripts/deploy-passwordless-migrations.ts"]

FROM oven/bun:1.3.9 AS runtime
ARG COMMIT_SHA
LABEL org.opencontainers.image.revision="${COMMIT_SHA}"
ENV NODE_ENV=production
ENV PORT=8787
WORKDIR /app
COPY --from=source /workspace .
COPY docker/retention-purge.mjs /usr/local/bin/retention-purge.mjs
WORKDIR /app/apps/api
EXPOSE 8787
CMD ["bun", "run", "src/bun.ts"]
