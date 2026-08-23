# Browser test runtime

## Gate design

`pnpm run test:browser` preserves the existing three-stage merge gate:

1. Smoke coverage: `playwright.config.ts`, all browser smoke/preview/security/archive specs, Chromium + Firefox + WebKit.
2. Real encrypted workflows: `playwright.e2e.config.ts`, all Personal Vault, Shared Vault, recovery, passkey, localization, and client-only crypto workflows, Chromium + Firefox + WebKit.
3. Production PWA coverage: `playwright.pwa.config.ts`, the offline PWA spec and all supported browser projects (with its existing capability skips).

The smoke and encrypted-workflow stages now run concurrently. Each gets a distinct port and Next development output directory:

| Stage | Port | Next output | Specs |
| --- | ---: | --- | --- |
| Smoke | `BROWSER_TEST_PORT` (default `3100`) | `.next/browser-smoke` | `granular-loading`, `mobile-preview`, `remembered-browser`, `security-headers`, `smoke`, `vault-archive-backup`, `vault-archive-import` |
| Encrypted workflows | `BROWSER_TEST_PORT + 1` | `.next/browser-e2e` | `encrypted-vault-workflows` |
| Production PWA | `BROWSER_TEST_PORT` | `.next` | `offline-pwa` |

The suite runner deletes its isolated development output before and after every run. The gate waits for both development stages before starting the PWA stage; a failed stage terminates its sibling and preserves the existing non-zero failure semantics. The coverage inventory is enforced by `src/tests/unit/browser-test-gate-inventory.test.ts`. Navigation performance remains a separate `pnpm run test:performance` check in CI.

The web full gate already builds production output before browser tests. It passes `BROWSER_TEST_REUSE_BUILD=1` so the PWA stage starts that verified build rather than running a second `next build`. Running `pnpm run test:browser:pwa` directly still builds production output, so targeted use remains self-contained.

## Timing evidence

All local measurements used the same generated Prisma client, local PostgreSQL database, installed browser binaries, Node 26.7.0, and the same working tree. The report contains only suite status and durations; it contains no account data, secrets, keys, OTPs, or decrypted content.

| Run | Smoke | Encrypted workflows | PWA | Browser-gate wall clock |
| --- | ---: | ---: | ---: | ---: |
| Baseline, sequential gate | 90 passed / 35.2s test time | 13 passed, 2 skipped / 1.7m test time | 5 passed, 4 skipped / 13.4s test time plus build | 152.14s |
| Optimized, isolated concurrent gate | 90 passed / 53.0s stage time | 13 passed, 2 skipped / 117.8s stage time | 5 passed, 4 skipped / 13.8s stage time | 132.34s |

The optimized local run reduced wall-clock time by 19.80s (13.0%). The dominant cost is the crypto-heavy encrypted-workflow stage, which occupies the critical path; parallelizing smoke removes its sequential cost without reducing that coverage. The local encrypted-workflow stage was slower under concurrent CPU pressure, so this change does not claim that every individual stage becomes faster.

The pre-change CI reference was GitHub Actions run [#32624357176](https://github.com/arrokh/rhasia-scret/actions/runs/32624357176), created by PR #111: the browser job ran from 06:59:23Z to 07:17:18Z (17m55s), and its browser-gate step ran from 07:01:35Z to 07:16:48Z (15m13s). The post-change CI wall-clock result is recorded in the ready-for-review PR and updated here after its required quality and browser jobs pass.

## Reproducible developer workflows

```bash
# Complete optimized browser merge gate.
pnpm run test:browser

# Target one isolated development suite.
pnpm run test:browser:smoke
pnpm run test:browser:e2e

# Run production PWA coverage independently; this builds first.
pnpm run test:browser:pwa

# Tune worker count for the available machine without changing coverage.
PLAYWRIGHT_WORKERS=1 pnpm run test:browser
```

`PLAYWRIGHT_WORKERS` remains the general worker override, and `PLAYWRIGHT_FULLY_PARALLEL` retains the existing configuration contract. CI sets `PLAYWRIGHT_SMOKE_WORKERS=1` while keeping two encrypted-workflow workers, so the concurrent smoke server cannot starve the crypto-heavy E2E server; local runs use the general worker setting unless this optional smoke-specific override is supplied. Parallel development servers increase transient CPU and memory use; constrained environments can lower workers while retaining every browser project and test file. No browser installation cache, test fixture, encrypted payload, or server state is shared between the two development outputs.
