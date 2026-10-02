# Self-hosted API load testing with k6

## Purpose and limits

This guide describes the isolated self-hosted load-test runner and its workloads. It measures behavior on a same-machine, resource-capped local stack; it is not a production SLO or a general capacity claim. Use synthetic data only. Do not target hosted, shared, or ordinary development databases. Remote load generators are out of scope.

## How the tools fit together

- `tools/load-test.mjs` is the thin safety and orchestration CLI entrypoint, exposed as `pnpm loadtest`. Its implementation lives in `tools/load-test/`, split by responsibility: configuration and validation, private run state, environment and Docker scope, project lifecycle, network and Mailpit, fixtures, scenarios, reporting, and teardown.
- `performance/k6/` is a directory of k6 JavaScript workload scripts—not an npm package or `@performance/k6` namespace. The scripts define scenario-specific k6 options, setup, requests, checks, and thresholds. `tools/load-test/validation.mjs` maps the selected scenario to a script, and `tools/load-test/scenario.mjs` invokes `k6 run`.

```text
pnpm loadtest CLI → isolated Compose + fixtures → k6 run performance/k6/<script>.js
                 → Markdown summary + telemetry JSON + exact-project teardown
```

With no arguments, `pnpm run loadtest` auto-generates a fresh local project/database for each of the nine non-capacity cases, including all three rate-limit boundaries. It starts, migrates, runs, and tears down each exact project, stopping on the first failure. Capacity is deliberately excluded. Individual lifecycle and scenario commands remain available below.

The `capacity` scenario reuses `performance/k6/personal-vault.js` with a caller-selected VU ceiling and duration. Above 20 VUs, it reuses at most 20 synthetic sessions; it does not bypass authentication or rate limits.

## Run safely

Use the repository-pinned toolchain (`mise install`). The run must use local Docker, the exact target `http://localhost:4000`, and a fresh project/database for each scenario or capacity step. The migration command is separate and requires explicit authorization for that exact generated database. The runner removes run-owned resources by default; retain a failed stack only when intentionally debugging it.

```sh
mise exec -- pnpm run loadtest
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

See `pnpm loadtest help` for all scenario names and options. Each run writes a human-readable `<scenario>-<timestamp>.summary.md` and a paired `<scenario>-<timestamp>.report.json` under ignored `test-results/load/<project>/`. Summaries show local-time timestamps, workload VUs, RPS, checks, and latency; browser-only smoke runs show checks without empty HTTP rows. The JSON report contains bounded execution and resource telemetry but omits the k6 metrics summary; the runner deletes its private temporary k6 summary after report generation. A latency-vs-RPS graph is not available from the current aggregate k6 summary; it would require time-bucketed metric capture, which adds load-generator I/O. Secrets, cookies, request bodies, and OTP values must not be recorded.

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

The initial same-machine, HTTP-only Personal Vault search used `capped-local-v3` and increased load in 5-VU steps with 2-minute holds. It stopped at 30 VUs when throughput plateaued, p95 latency rose, and web CPU reached its 1-CPU limit signal. These are the results of that bounded step search, not the profile's highest measured VU count.

| VUs | Requests/s | p95 latency | Web CPU peak | Web memory peak |
| --: | ---------: | ----------: | -----------: | --------------: |
|  20 |     582.43 |    76.55 ms |      102.36% |   195 / 512 MiB |
|  25 |     570.18 |    91.40 ms |       98.07% | 201.3 / 512 MiB |
|  30 |     570.08 |   101.96 ms |       105.6% | 216.6 / 512 MiB |

The 30-VU run had zero HTTP failures and 136,924/136,924 checks. Web CPU was at least 95% in 6/10 samples; API peaked at 78.78% CPU and PostgreSQL at 62.9%. The k6 generator peaked at 18.4% CPU, so it was not the bottleneck.

A separate `capped-local-v3` run at the 100-VU ceiling for 2 minutes completed 65,312 requests at 543.90 requests/s, with zero HTTP failures, 130,624/130,624 checks, p95 266.70 ms, and p99 319.01 ms. Web CPU peaked at 102.95%; API peaked at 77.24% CPU and PostgreSQL at 62.9%. This remains a characterization of the v3 resource profile only.

### Current capped-local-v4 Compose resource limits

| Service              |        CPU |       Memory |
| -------------------- | ---------: | -----------: |
| PostgreSQL, API, web | 1 CPU each | 256 MiB each |
| Retention scheduler  |  0.125 CPU |      256 MiB |
| Mailpit              |   0.25 CPU |      256 MiB |
| One-shot migration   |      1 CPU |      256 MiB |

The v3 100-VU migration sample peaked at 266.5 MiB. A fresh v4 migration completed with a sampled peak of 117.7 MiB; this is one run and does not guarantee the same usage on every migration.

A fresh `capped-local-v4` run at 100 VUs for 2 minutes completed 62,474 requests at 519.40 requests/s, with zero HTTP failures and 124,948/124,948 checks. p95 was 289.32 ms and p99 was 399.43 ms.

| Service            | CPU peak |     Memory peak |
| ------------------ | -------: | --------------: |
| API                |   99.35% | 249.5 / 256 MiB |
| Web                |   99.14% | 206.9 / 256 MiB |
| PostgreSQL         |   62.36% | 40.45 / 256 MiB |
| Mailpit            |    3.25% | 32.36 / 256 MiB |
| Retention          |    0.01% |  5.32 / 256 MiB |
| One-shot migration |  100.38% | 117.7 / 256 MiB |

The API reached 97.47% of its memory limit and both API and web approached their 1-CPU caps. Treat this as a successful but saturated same-machine v4 run, not a sustainable-capacity target or a general capacity claim. The run-owned project was torn down after completion.

For capacity discovery, increase in bounded 5-VU steps and hold each for 2 minutes. Stop on HTTP/k6/health failure, memory at or above 85% of a service limit, or CPU at or above 95% in at least 80% of samples. Also stop when a service reaches 100% CPU in a sample and the next 5-VU step does not improve throughput while p95 latency rises. Never exceed the runner's 100-VU hard ceiling; that ceiling is a safety bound, not a capacity result.

## Default non-capacity suite results (2026-10-02)

`pnpm run loadtest` completed all nine non-capacity scenarios on the same-machine `capped-local-v4` profile. Every run completed with zero failed checks. The VU column shows the configured workload (stages where applicable); RPS is the run-wide HTTP request rate. Browser smoke is browser-only, so HTTP request rate and latency do not apply.

| Scenario                      | VU profile | Requests (avg RPS) | p95 latency | Checks passed |     HTTP failures |
| ----------------------------- | ---------- | -----------------: | ----------: | ------------: | ----------------: |
| `returning-personal`          | 1 → 5 → 10 |   125,898 (331.29) |    35.60 ms |       251,796 |                 0 |
| `account-mutations`           | max 10     |         242 (2.02) |    42.99 ms |           484 |                 0 |
| `browser-smoke`               | 1          |       browser-only |         n/a |             2 |               n/a |
| `rate-limits` (email)         | 1          |          24 (1.63) |   117.50 ms |            20 |    1 expected 429 |
| `rate-limits` (network)       | 1          |          84 (1.82) |   433.29 ms |            65 |    1 expected 429 |
| `rate-limits` (authenticated) | 1          |        199 (32.13) |    66.72 ms |           207 | 194 expected 429s |
| `first-time`                  | 1          |           5 (0.62) |     6.62 ms |             2 |                 0 |
| `shared-vault`                | 1 → 5 → 10 |   130,292 (342.78) |    32.35 ms |       260,584 |                 0 |
| `shared-account-mutations`    | max 1      |         121 (1.01) |    45.35 ms |           242 |                 0 |

HTTP failures in the three rate-limit probes are the expected `429` responses; their policy checks passed. The read scenarios approached the local CPU limits: Personal Vault peaked at 95.95% API and 100.76% web CPU, while Shared Vault peaked at 82.94% API and 98.90% web CPU. These are measurements of this resource-capped local stack, not a sustainable-capacity target or a general capacity claim. The browser smoke report records 2/2 checks; it does not produce HTTP RPS or latency metrics.

## Verification

Run the runner's regression tests with `mise exec -- pnpm test:loadtest`. Keep detailed functional assertions in Playwright; k6 browser VUs are only for small journey checks alongside HTTP load. Retain only sanitized reports and remove the exact run project after each test.
