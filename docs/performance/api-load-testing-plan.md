# Self-hosted API load testing with k6

## Purpose and limits

This guide describes the isolated self-hosted load-test runner and its workloads. It measures behavior on a same-machine, resource-capped local stack; it is not a production SLO or a general capacity claim. Use synthetic data only. Do not target hosted, shared, or ordinary development databases. Remote load generators are out of scope.

## How the tools fit together

- `tools/load-test.mjs` is the safety and orchestration CLI, exposed as `pnpm loadtest`. It creates a unique run project, verifies the target and Docker scope, manages the Compose stack and explicit migration, prepares fixtures, starts k6, writes a sanitized report, and tears down the run.
- `performance/k6/` is a directory of k6 JavaScript workload scripts—not an npm package or `@performance/k6` namespace. The scripts define scenario-specific k6 options, setup, requests, checks, and thresholds. `tools/load-test.mjs` maps the selected scenario to a script and invokes `k6 run`.

```text
pnpm loadtest CLI → isolated Compose + fixtures → k6 run performance/k6/<script>.js
                 → sanitized report + exact-project teardown
```

The `capacity` scenario reuses `performance/k6/personal-vault.js` with a caller-selected VU ceiling and duration. Above 20 VUs, it reuses at most 20 synthetic sessions; it does not bypass authentication or rate limits.

## Run safely

Use the repository-pinned toolchain (`mise install`). The run must use local Docker, the exact target `http://localhost:4000`, and a fresh project/database for each scenario or capacity step. The migration command is separate and requires explicit authorization for that exact generated database. The runner removes run-owned resources by default; retain a failed stack only when intentionally debugging it.

```sh
mise exec -- pnpm loadtest help
mise exec -- pnpm loadtest new --target http://localhost:4000
# Set PROJECT to the generated ID printed by `new`.
mise exec -- pnpm loadtest up --project "$PROJECT" --target http://localhost:4000
mise exec -- pnpm loadtest migrate --project "$PROJECT" --target http://localhost:4000 \
  --confirm-migration "$PROJECT/loadtest_vault"
mise exec -- pnpm loadtest run --project "$PROJECT" --target http://localhost:4000 \
  --scenario returning-personal
```

Capacity steps require an explicit matching ceiling and a duration from 1 second to 10 minutes. Start each step with a new project and freshly migrated database:

```sh
mise exec -- pnpm loadtest run --project "$PROJECT" --target http://localhost:4000 \
  --scenario capacity --max-vus 30 --confirm-high-vus 30 --duration 2m
```

See `pnpm loadtest help` for all scenario names and options. Reports are stored under ignored `test-results/load/<project>/`; secrets, cookies, request bodies, and OTP values must not be recorded.

## Workloads

| Scenario                   | Purpose                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------ |
| `returning-personal`       | Personal Vault reads at the default 1/5/10 VU stages; includes a small browser check.      |
| `capacity`                 | Constant-VU Personal Vault reads for a bounded, explicitly confirmed ceiling and duration. |
| `account-mutations`        | Personal Vault account mutation behavior, measured separately from reads.                  |
| `first-time`               | Low-volume passwordless sign-in and first-time Personal Vault setup.                       |
| `shared-vault`             | Shared Vault invitation/member setup and authorized reads.                                 |
| `shared-account-mutations` | Shared Vault account mutations, isolated from reads.                                       |
| `rate-limits`              | Boundary checks; requires `--boundary email`, `network`, or `authenticated`.               |
| `browser-smoke`            | Small browser-only flow check.                                                             |

Expected `429` responses are successes only in the rate-limit boundary scenarios. Other unexpected HTTP failures, health failures, or k6 failures stop the run. Each scenario uses its own fresh project/database.

## Local capacity characterization

Measured with the `capped-local-v3` profile, same-machine k6, HTTP-only Personal Vault reads, and 2-minute holds. The test stopped at 30 VUs: request throughput had plateaued while p95 latency rose and the web container reached its 1-CPU limit signal. No HTTP failures or health errors occurred; memory remained below the limit. This is the highest measured step for this profile, not a theoretical maximum.

| VUs | Requests/s | p95 latency | Web CPU peak | Web memory peak |
| --: | ---------: | ----------: | -----------: | --------------: |
|  20 |     582.43 |    76.55 ms |      102.36% |   195 / 512 MiB |
|  25 |     570.18 |    91.40 ms |       98.07% | 201.3 / 512 MiB |
|  30 |     570.08 |   101.96 ms |       105.6% | 216.6 / 512 MiB |

The 30-VU run had zero HTTP failures and 136,924/136,924 checks. Web CPU was at least 95% in 6/10 samples; API peaked at 78.78% CPU and PostgreSQL at 62.9%. The k6 generator peaked at 18.4% CPU, so it was not the bottleneck.

### Compose resource limits

| Service              |        CPU |       Memory |
| -------------------- | ---------: | -----------: |
| PostgreSQL, API, web | 1 CPU each | 512 MiB each |
| Retention scheduler  |  0.125 CPU |      128 MiB |
| Mailpit              |   0.25 CPU |      256 MiB |
| One-shot migration   |      1 CPU |        1 GiB |

For capacity discovery, increase in bounded 5-VU steps and hold each for 2 minutes. Stop on HTTP/k6/health failure, memory at or above 85% of a service limit, or CPU at or above 95% in at least 80% of samples. Also stop when a service reaches 100% CPU in a sample and the next 5-VU step does not improve throughput while p95 latency rises. Never exceed the runner's 100-VU hard ceiling; that ceiling is a safety bound, not a capacity result.

## Verification

Run the runner's regression tests with `mise exec -- pnpm test:loadtest`. Keep detailed functional assertions in Playwright; k6 browser VUs are only for small journey checks alongside HTTP load. Retain only sanitized reports and remove the exact run project after each test.
