# Browser test runtime

## Gate design

`pnpm run test:browser` preserves the existing three-stage merge gate:

1. Smoke coverage: `playwright.config.ts`, all browser smoke/preview/security/archive specs, Chromium in hosted CI.
2. Real encrypted workflows: `playwright.e2e.config.ts`, all Personal Vault, Shared Vault, recovery, passkey, localization, and client-only crypto workflows, Chromium in hosted CI.
3. Production PWA coverage: `playwright.pwa.config.ts`, the offline PWA spec and the Chromium project used by hosted CI.

Firefox and WebKit are intentionally deferred and commented out of both the CI workflow matrix and Playwright project configuration. No Firefox or WebKit test is expected for this support focus.

The local gate uses distinct ports and Next development output directories for smoke and encrypted workflows. They run concurrently by default; `BROWSER_TEST_SEQUENTIAL=1` retains the constrained-machine fallback. GitHub Actions instead runs each `(suite, browser)` pair on an independent runner with its own PostgreSQL service. Smoke keeps one worker for stability; encrypted workflows use two workers because their scenarios use distinct browser-E2E identities. The two development matrix cells, production PWA/navigation job, web quality job, mobile job, core job, repository job, and change-detection job are independent (8 workflow jobs total).

CI and the required local gate focus on Chromium. Firefox and WebKit are commented out of the hosted matrix and Playwright project configuration, and no non-Chromium coverage is expected.

| Stage               |                                 Port | Next output           | Specs                                                                                                                                   |
| ------------------- | -----------------------------------: | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Smoke               | `BROWSER_TEST_PORT` (default `3100`) | `.next/browser-smoke` | `granular-loading`, `mobile-preview`, `remembered-browser`, `security-headers`, `smoke`, `vault-archive-backup`, `vault-archive-import` |
| Encrypted workflows |              `BROWSER_TEST_PORT + 1` | `.next/browser-e2e`   | `encrypted-vault-workflows`                                                                                                             |
| Production PWA      |                  `BROWSER_TEST_PORT` | `.next`               | `offline-pwa`                                                                                                                           |

The suite runner deletes its isolated development output before and after every run. In the default concurrent mode, the gate waits for both development stages before starting the PWA stage and terminates the sibling when either fails. In sequential mode, it fails fast before starting the next stage. Both modes preserve the existing non-zero failure semantics and run the same coverage. The coverage inventory and complete CI suite/browser matrix are enforced by `src/tests/unit/architecture/browser-test-gate-inventory.test.ts`. Navigation performance remains an explicit `pnpm run test:performance` check, sequentially after production PWA tests on their dedicated runner. Neither shares a database with another CI job.

The web full gate already builds production output before browser tests. It passes `BROWSER_TEST_REUSE_BUILD=1` so the PWA stage starts that verified build rather than running a second `next build`. Running `pnpm run test:browser:pwa` directly still builds production output, so targeted use remains self-contained.

## September 2026 CI diagnosis

Baseline: [CI run #34754665849](https://github.com/arrokh/rhasia-scret/actions/runs/34754665849), commit `68459990c1f59ea93e2fa6bba5cc5755d2c5bf1d`, 2026-09-13. Timings below come from the GitHub Jobs API and timestamped job logs, not a local estimate.

| Measured work                                                     |      Duration | Finding                                                             |
| ----------------------------------------------------------------- | ------------: | ------------------------------------------------------------------- |
| Browser job, including setup and cleanup                          |        12m14s | Critical path; workflow creation through completion was 12m17s      |
| Smoke: 99 passed, one worker                                      |        242.0s | All three engines serialized                                        |
| Encrypted workflows: 11 passed, 4 skipped, one worker             |        312.6s | All three engines serialized after smoke                            |
| Production PWA: 9 passed, 6 skipped                               |         47.5s | Included another production build; followed both development suites |
| Navigation performance step                                       |           29s | Ran after the complete browser gate                                 |
| Browser system dependency installation                            |           31s | Browser cache does not cache OS packages                            |
| Browser pnpm install / pnpm cache restore / browser cache restore | 12s / 8s / 6s | Both caches hit; cache misses did not explain this run              |
| Quality job                                                       |         5m01s | Serial mobile verification and repeated package checks              |
| Mobile full verification                                          |           82s | Includes lint, types, tests, Expo Doctor, and both JS exports       |
| Root unit/integration/contract test step                          |           64s | Includes repeated core/mobile tests; web Vitest itself was 51.66s   |
| Quality production build                                          |           32s | Already includes client-output verification in `postbuild`          |

The browser gate spent 554.6s (92% of its 602.1s stage total) in the two development suites. The older workflow set `BROWSER_TEST_SEQUENTIAL=1`, `PLAYWRIGHT_SMOKE_WORKERS=1`, and `PLAYWRIGHT_E2E_WORKERS=1`: the general `PLAYWRIGHT_WORKERS=2` did not apply to those suites. The evidence supports runner-level distribution before deleting tests or tuning unit-test isolation.

Changes in this checkout:

- Run smoke and encrypted workflows in a `suite: [smoke, e2e]` × `browser: [chromium]` matrix, with Firefox and WebKit commented out. Preserve one smoke worker, use two encrypted-workflow workers, and keep separate databases to avoid prior CPU contention and global E2E fixture cleanup collisions.
- Forward Playwright CLI arguments through the suite runner so `--project` actually selects one engine. Use the list reporter in CI for individual test durations; the previous dot reporter buffered output and did not expose per-test timings.
- Run mobile verification independently. Keep full core verification in quality; scope later lint/typecheck/tests to web, retain release-evidence tests, and remove the extra client-output verification already invoked by `build`.
- Run production dependency/license checks once in quality. Install/cache only the selected browser for each matrix job. PWA still installs all supported engines and verifies a production build.
- Set an eight-minute timeout on every CI job as a hard failure ceiling. This is enforced after the work is distributed; GitHub runner queue time is outside that ceiling.

The E2E log boundaries put Chromium at approximately 135s, excluding shared startup/teardown. This is an engine-level approximation from worker transition timestamps, not individual test measurements. With approximately 100s of existing setup, the Chromium target suggests a roughly four-minute job. Fresh compilation on every runner, cold downloads, and runner availability can change that result. **A successful hosted run below five minutes remains the performance target; the eight-minute timeout is the failure ceiling.**

Local matrix-cell validation on the current checkout passed: core `1.7s`, mobile `21.4s`, Chromium smoke `33.5s`, and Chromium encrypted workflows `111.5s`. These timings exclude hosted-runner queue time and are not a substitute for the hosted measurement. The workflow runs on `main` and pull requests targeting `main`; do not use a merge as a substitute for the required local full gate.

This approach spends more aggregate runner time and browser-cache storage to reduce elapsed time. Eight jobs run when change detection is included. If a hosted job exceeds the budget, use its individual timings to split the slowest check further or investigate its specific slow scenario. Do not reduce KDF work factors, enable E2E authentication in production, disable test isolation, or remove Chromium encryption and authorization coverage to reach a timing target. Playwright also recommends [one CI worker and distribution across machines](https://playwright.dev/docs/ci) for stability.

## Historical timing evidence

All local measurements used the same generated Prisma client, local PostgreSQL database, installed browser binaries, Node 24.19.0, and the same working tree. The report contains only suite status and durations; it contains no account data, secrets, keys, OTPs, or decrypted content.

| Run                                 |                        Smoke |                      Encrypted workflows |                                              PWA | Browser-gate wall clock |
| ----------------------------------- | ---------------------------: | ---------------------------------------: | -----------------------------------------------: | ----------------------: |
| Baseline, sequential gate           |  90 passed / 35.2s test time |    13 passed, 2 skipped / 1.7m test time | 5 passed, 4 skipped / 13.4s test time plus build |                 152.14s |
| Optimized, isolated concurrent gate | 90 passed / 53.0s stage time | 13 passed, 2 skipped / 117.8s stage time |           5 passed, 4 skipped / 13.8s stage time |                 132.34s |
| Optimized CI gate #32630093624      | 90 passed / 12.2m stage time |  11 passed, 4 skipped / 13.4m stage time |           5 passed, 4 skipped / 59.0s stage time |                  14m26s |

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

# Use the serial fallback on a constrained local machine.
CI=true \
BROWSER_TEST_SEQUENTIAL=1 \
PLAYWRIGHT_SMOKE_WORKERS=1 \
PLAYWRIGHT_E2E_WORKERS=1 \
pnpm run test:browser
```

Run exactly one development matrix cell (CI preserves existing capability skips):

```bash
CI=true PLAYWRIGHT_WORKERS=1 pnpm run test:browser:smoke --project=chromium --reporter=list
CI=true PLAYWRIGHT_WORKERS=1 PLAYWRIGHT_E2E_WORKERS=2 pnpm run test:browser:e2e --project=chromium --reporter=list
```

`PLAYWRIGHT_WORKERS` remains the general worker override; `PLAYWRIGHT_SMOKE_WORKERS` and `PLAYWRIGHT_E2E_WORKERS` optionally override it for local suite runners. `PLAYWRIGHT_FULLY_PARALLEL` retains its existing configuration contract. GitHub Actions uses one worker for smoke, two for encrypted workflows, and two for PWA. The complete `test:full` gate defaults to sequential development suites for deterministic constrained-machine results; set `BROWSER_TEST_SEQUENTIAL=0` to opt into concurrent local suites. Encrypted workflows deliberately use `next dev`: their controlled authentication and passkey seams must remain disabled in production. PWA continues to exercise `next start` production output.
