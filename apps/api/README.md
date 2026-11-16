# Go API service

The production `/v1/**` API runtime is Go/Echo only. The standalone and Docker entrypoint is `cmd/api`; Vercel exposes Go functions under `api/` and delegates them through `vercelruntime/` to the same API composition. Docker builds a Go binary, and the Vercel API configuration does not install or bundle a Node API. Vercel auto-detects the Go functions; `vercel.json` intentionally omits a custom build command and static output directory. A no-op build command can make Vercel require static output even when the deployment contains only functions.

`apps/api/package.json` is the private `@rhasia-scret/api-test-tools` workspace package. It has no production dependencies and contains Node.js tooling for tests, disposable integration-test orchestration, and deployment verification. Vercel's `ignoreCommand` also runs a Node repository script to decide whether an API deployment can be skipped; that script is build control, not request handling or an API runtime.

The Go API reads `RHSIA_RUNTIME_ENV` for local and non-Vercel runtime mode. Docker sets it to `production`; local Go launchers set it to `development`. Vercel uses its platform-provided `VERCEL_ENV`. `NODE_ENV` belongs to the Web/Node toolchain and is not read by the Go API.

Sqitch runs in a separate migration image and is not part of the API request runtime. `apps/api/prisma/archive/` is read-only historical evidence; Sqitch is the active migration authority.

See [the monorepo guide](../../docs/monorepo.md), [self-hosting guide](../../docs/self-hosting.md), and [Go/Echo and Sqitch migration record](../../docs/api-go-echo-sqitch-migration-plan.md) for architecture, environment, and deployment details.
