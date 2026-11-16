# Layer-first Go API package layout

- **Status:** Accepted
- **Date:** 2026-11-14
- **Related:** [Go/Echo API rewrite plan](../api-go-echo-sqitch-migration-plan.md), [Monorepo map](../monorepo.md)

## Context

The Go API was initially organized by bounded context, with application, domain, infrastructure, and HTTP packages nested under each context. The maintainer requested a flatter layout modeled on the BGN API so contributors can find a technical layer from one stable location.

The API also has strict authorization, encryption, and client/server boundaries. Context subpackages preserve Go package-level isolation, but make the layout less like the reference and introduce many import paths. The maintainer approved flattening each implementation layer into a single Go package to match the reference more closely.

## Decision

Organize implementation code by technical layer and keep each layer in one flat Go package:

```text
apps/api/internal/
├── app/api/       # Runtime composition
├── entity/        # Domain types and rules
├── handler/       # HTTP presentation handlers
├── repository/    # PostgreSQL persistence adapters
└── service/       # Application use cases, ports, and outbound adapters
```

Use context-prefixed filenames (for example, `identity_*.go` and `vault_membership_*.go`) to keep ownership visible. The old `adapter/<context>` implementations now live in `service`; `modules/<context>` facades are removed. Shared transport, configuration, PostgreSQL-pool, localization, and test-support packages retain their existing ownership.

This intentionally trades package-level isolation between bounded contexts for the single-package-per-layer layout. Preserve context ownership in names, interfaces, and use-case design; do not use the flatter package as a reason to couple unrelated contexts or weaken authorization, encryption, audit-redaction, or client/server boundaries. Keep composition in `internal/app/api`. This is a directory and import-path change only: preserve routes and wire contracts, SQL behavior, authorization order, encryption boundaries, logging, lifecycle behavior, and dependency/toolchain choices. Do not add an ORM or runtime framework to imitate the reference API.

This ADR supersedes the prior Go API plan's package-layout recommendation only. The plan's Go/Echo, pgx, OpenAPI, Sqitch, deployment, and security decisions remain in force.

## Consequences

- `apps/api/internal` exposes four flat implementation packages. Go package-level context isolation is no longer enforced by directories, so names and tests must keep ownership explicit.
- Go import paths change and all code, tests, architecture fixtures, tooling, and current documentation must use the flat layer paths.
- The generated OpenAPI contract and deployed `/v1/**` behavior do not change.
- A Go architecture test prevents implementation files from being nested under the flat layer roots and checks that each root contains its matching package. It also guards removal of the obsolete `adapter` and `modules` directories.
