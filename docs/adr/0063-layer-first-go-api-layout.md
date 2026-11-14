# Layer-first Go API package layout

- **Status:** Accepted
- **Date:** 2026-11-14
- **Related:** [Go/Echo API rewrite plan](../api-go-echo-sqitch-migration-plan.md), [Monorepo map](../monorepo.md)

## Context

The Go API was initially organized by bounded context, with application, domain, infrastructure, and HTTP packages nested under each context. The maintainer requested a flatter, horizontal layout modeled on the BGN API so a contributor can find a technical layer from one stable location.

The API also carries strict authorization, encryption, and client/server boundaries. A single global Go package per layer would erase useful package boundaries, create identifier collisions, and make unrelated contexts easier to couple. Some module-root packages are intentional cross-context APIs.

## Decision

Organize implementation packages by technical layer first and bounded context second:

```text
apps/api/internal/
├── app/api/                 # Runtime composition
├── adapter/<context>/       # SMTP, auth-provider, and other outbound adapters
├── entity/<context>/        # Domain types and rules
├── handler/<context>/       # HTTP presentation handlers
├── repository/<context>/    # PostgreSQL persistence adapters
├── service/<context>/       # Application use cases and ports
└── modules/<context>/       # Context-owned public APIs where required
```

Move HTTP handlers out of `modules/<context>/presentation/http`, application workflows out of `modules/<context>/application`, domain code out of `modules/<context>/domain`, and infrastructure into `repository` or `adapter` according to its role. The server-composition package belongs under `internal/app/api`.

Keep one package per context inside each technical layer. Do not merge every context into one giant `handler`, `service`, or `repository` Go package. Cross-context calls continue through the owning context's public API where one exists. Module-root packages may expose aliases and delegate to the owning layer, but SQL persistence and outbound-provider implementations belong in `repository` or `adapter`, not in those facades. Shared transport, configuration, PostgreSQL-pool, and test-support packages retain their existing ownership.

This is a directory and import-path change only. Preserve all HTTP routes and wire contracts, SQL behavior, authorization order, encryption boundaries, audit redaction, logging, lifecycle behavior, and dependency/toolchain choices. Do not add a new ORM or runtime framework to imitate the reference API.

This ADR supersedes the prior Go API plan's package-layout recommendation only. The plan's Go/Echo, pgx, OpenAPI, Sqitch, deployment, and security decisions remain in force.

## Consequences

- `apps/api/internal` exposes a short, stable list of horizontal layers while context subpackages preserve ownership and package isolation.
- Go import paths change and all code, tests, architecture fixtures, tooling, and current documentation must use the new paths.
- The generated OpenAPI contract and deployed `/v1/**` behavior do not change.
- A Go architecture test prevents implementation layers from being nested back under `internal/modules/<context>`.
