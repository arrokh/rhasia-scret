# syntax=docker/dockerfile:1

ARG COMMIT_SHA=unknown
FROM node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df AS base
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
# Defer workspace lifecycle scripts until the source stage has the Prisma schema.
RUN --mount=type=cache,id=rhasia-scret-pnpm,target=/pnpm/store pnpm install --frozen-lockfile --filter @rhasia-scret/api... --ignore-scripts

FROM dependencies AS source
COPY apps/api apps/api
COPY packages/api-contract packages/api-contract
COPY packages/client-vault-core packages/client-vault-core
# Prisma 7 loads prisma.config.ts even for generation; this is never a runtime or migration URL.
ENV DIRECT_URL=postgresql://localhost:5432/rhasia_scret_generate
RUN cd apps/api && ./node_modules/.bin/prisma generate --config prisma.config.ts

FROM source AS build
# Prisma Client is generated in the source stage; only bundle the Node artifact here.
RUN pnpm --filter @rhasia-scret/api build:node

FROM source AS deployable
# Deploy only the API workspace's production dependency graph instead of copying the
# complete workspace install (which includes test/build tooling). The workspace patch
# is mobile-only, so remove its metadata in this API-only build stage before deploy.
RUN node -e 'const fs = require("fs"); const path = "package.json"; const manifest = JSON.parse(fs.readFileSync(path, "utf8")); delete manifest.patchedDependencies; fs.writeFileSync(path, JSON.stringify(manifest));' \
  && node -e 'const fs = require("fs"); const path = "pnpm-workspace.yaml"; const source = fs.readFileSync(path, "utf8"); fs.writeFileSync(path, source.replace(/\npatchedDependencies:\n(?:  .*\n?)*$/u, "\n"));'

FROM deployable AS production
RUN pnpm --filter @rhasia-scret/api deploy --prod --legacy --ignore-scripts /tmp/api \
  && prisma_package="$(find /tmp/api/node_modules/.pnpm -maxdepth 1 -type d -name 'prisma@*' -print -quit)" \
  && test -n "$prisma_package" \
  && ln -s ".pnpm/$(basename "$prisma_package")/node_modules/prisma" /tmp/api/node_modules/prisma \
  && mkdir -p /tmp/api/node_modules/.bin \
  && ln -s "../prisma/build/index.js" /tmp/api/node_modules/.bin/prisma \
  && DIRECT_URL=postgresql://127.0.0.1:5432/rhasia_scret_generate /tmp/api/node_modules/.bin/prisma generate --config /tmp/api/prisma.config.ts

FROM production AS runtime-prepared
# The API runtime does not need Prisma CLI, Studio, or other optional tooling after
# generation. Redeploy without optional dependencies, then use the full deployment's
# CLI only during this build stage to generate the client into the lean deployment.
RUN pnpm --filter @rhasia-scret/api deploy --prod --no-optional --legacy --ignore-scripts /tmp/api-runtime \
  && printf '%s\n' 'import { defineConfig, env } from "prisma/config"; export default defineConfig({ schema: "/tmp/api-runtime/prisma/schema.prisma", datasource: { url: env("DIRECT_URL") } });' > /tmp/api/runtime.prisma.config.ts \
  && cd /tmp/api-runtime \
  && DIRECT_URL=postgresql://127.0.0.1:5432/rhasia_scret_generate /tmp/api/node_modules/.bin/prisma generate --config /tmp/api/runtime.prisma.config.ts

FROM production AS migration-prepared
# Migration verification scripts are TypeScript, so add only the tsx tool and its
# transitive dependencies to the otherwise production-only deployment.
RUN mkdir -p /tmp/migration-tools \
  && node -e 'const manifest = require("./apps/api/package.json"); console.log(JSON.stringify({ private: true, dependencies: { tsx: manifest.devDependencies.tsx.replace(/^[^0-9]*/, "") } }));' > /tmp/migration-tools/package.json \
  && pnpm --dir /tmp/migration-tools install --ignore-scripts --no-lockfile \
  && cp -a /tmp/migration-tools/node_modules/.pnpm/. /tmp/api/node_modules/.pnpm/. \
  && cp -a /tmp/migration-tools/node_modules/.bin/tsx /tmp/api/node_modules/.bin/tsx

FROM base AS migration
WORKDIR /workspace/apps/api
ENV NODE_ENV=production
ARG COMMIT_SHA
LABEL org.opencontainers.image.revision="${COMMIT_SHA}"
COPY --from=migration-prepared /tmp/api ./
USER node
CMD ["node_modules/.bin/tsx", "scripts/deploy-passwordless-migrations.ts"]

FROM oven/bun:1.3.9-alpine@sha256:9028ee7a60a04777190f0c3129ce49c73384d3fc918f3e5c75f5af188e431981 AS runtime
ARG COMMIT_SHA
LABEL org.opencontainers.image.revision="${COMMIT_SHA}"
ENV NODE_ENV=production
ENV PORT=8787
WORKDIR /app
# The self-hosted runtime remains Bun-primary and receives the lean deployment
# without Prisma's migration/Studio tooling.
COPY --from=runtime-prepared --chown=bun:bun /tmp/api-runtime ./apps/api
COPY docker/retention-purge.mjs /usr/local/bin/retention-purge.mjs
USER bun
WORKDIR /app/apps/api
EXPOSE 8787
CMD ["bun", "run", "src/bun.ts"]
