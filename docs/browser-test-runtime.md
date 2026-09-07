# Browser test runtime

## Gate design

`pnpm run test:browser` preserves the existing three-stage merge gate:

1. Smoke coverage: `playwright.config.ts`, all browser smoke/preview/security/archive specs, Chromium + Firefox + WebKit.
2. Real encrypted workflows: `playwright.e2e.config.ts`, all Personal Vault, Shared Vault, recovery, passkey, localization, and client-only crypto workflows, Chromium + Firefox + WebKit.
3. Production PWA coverage: `playwright.pwa.config.ts`, the offline PWA spec and all supported browser projects (with its existing capability skips).

The smoke and encrypted-workflow stages use distinct ports and Next development output directories. They run concurrently by default for fast local feedback. GitHub Actions sets `BROWSER_TEST_SEQUENTIAL=1` to run them one after the other, avoiding the cross-suite CPU and database contention that made browser outcomes intermittent on constrained hosted runners:

| Stage | Port | Next output | Specs |
| --- | ---: | --- | --- |
| Smoke | `BROWSER_TEST_PORT` (default `3100`) | `.next/browser-smoke` | `granular-loading`, `mobile-preview`, `remembered-browser`, `security-headers`, `smoke`, `vault-archive-backup`, `vault-archive-import` |
| Encrypted workflows | `BROWSER_TEST_PORT + 1` | `.next/browser-e2e` | `encrypted-vault-workflows` |
| Production PWA | `BROWSER_TEST_PORT` | `.next` | `offline-pwa` |

The suite runner deletes its isolated development output before and after every run. In the default concurrent mode, the gate waits for both development stages before starting the PWA stage and terminates the sibling when either fails. In sequential mode, it fails fast before starting the next stage. Both modes preserve the existing non-zero failure semantics and run the same coverage. The coverage inventory and CI serialization setting are enforced by `src/tests/unit/architecture/browser-test-gate-inventory.test.ts`. Navigation performance remains a separate `pnpm run test:performance` check in CI.

The web full gate already builds production output before browser tests. It passes `BROWSER_TEST_REUSE_BUILD=1` so the PWA stage starts that verified build rather than running a second `next build`. Running `pnpm run test:browser:pwa` directly still builds production output, so targeted use remains self-contained.

## Timing evidence

All local measurements used the same generated Prisma client, local PostgreSQL database, installed browser binaries, Node 24.19.0, and the same working tree. The report contains only suite status and durations; it contains no account data, secrets, keys, OTPs, or decrypted content.

| Run | Smoke | Encrypted workflows | PWA | Browser-gate wall clock |
| --- | ---: | ---: | ---: | ---: |
| Baseline, sequential gate | 90 passed / 35.2s test time | 13 passed, 2 skipped / 1.7m test time | 5 passed, 4 skipped / 13.4s test time plus build | 152.14s |
| Optimized, isolated concurrent gate | 90 passed / 53.0s stage time | 13 passed, 2 skipped / 117.8s stage time | 5 passed, 4 skipped / 13.8s stage time | 132.34s |
| Optimized CI gate #32630093624 | 90 passed / 12.2m stage time | 11 passed, 4 skipped / 13.4m stage time | 5 passed, 4 skipped / 59.0s stage time | 14m26s |

The optimized local run reduced wall-clock time by 19.80s (13.0%). The dominant cost is the crypto-heavy encrypted-workflow stage, which occupies the critical path; parallelizing smoke removes its sequential cost without reducing that coverage. The local encrypted-workflow stage was slower under concurrent CPU pressure, so this change does not claim that every individual stage becomes faster.

The pre-change CI reference was GitHub Actions run [#32624357176](https://github.com/arrokh/rhasia-scret/actions/runs/32624357176), created by PR #111: the browser job ran from 06:59:23Z to 07:17:18Z (17m55s), and its browser-gate step ran from 07:01:35Z to 07:16:48Z (15m13s). The successful post-change CI run [#32630093624](https://github.com/arrokh/rhasia-scret/actions/runs/32630093624) ran the browser job from 09:06:48Z to 09:24:02Z (17m14s), and its browser-gate step from 09:08:50Z to 09:23:16Z (14m26s): 47s (5.1%) faster for the gate and 41s (3.8%) faster for the full browser job. Its quality, browser, and security checks all passed.

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

# Reproduce the stable constrained-runner topology used by GitHub Actions.
BROWSER_TEST_SEQUENTIAL=1 PLAYWRIGHT_SMOKE_WORKERS=1 PLAYWRIGHT_E2E_WORKERS=1 pnpm run test:browser
```

`PLAYWRIGHT_WORKERS` remains the general worker override, and `PLAYWRIGHT_FULLY_PARALLEL` retains the existing configuration contract. CI sets `BROWSER_TEST_SEQUENTIAL=1`, `PLAYWRIGHT_SMOKE_WORKERS=1`, and `PLAYWRIGHT_E2E_WORKERS=1`; local runs retain concurrent suites and use the general worker setting unless these optional overrides are supplied. Parallel development servers increase transient CPU, memory, and shared-database pressure, so constrained environments should use sequential mode while retaining every browser project and test file. Distinct development output directories continue to isolate each Next.js server's generated build state.
