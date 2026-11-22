# Security review verification index

**Status:** Local source review and remediation work is recorded; **not security-cleared**. Hosted settings, deployed behavior, and complete scanner coverage remain unverified. This short index is intentionally not the detailed audit report. It records local verification results without moving detailed audit material into source control. Detailed source traces and review evidence, including current integrity digests, remain outside the repository under `/Users/arrokh/security-audit-skill/rhasia-scret/run-1/`.

- **Repository:** `/Users/arrokh/work/personal/rhasia-scret`
- **Review base:** `933e3a114cb6fa7101fb7b4b215509bf0f2695ca`
- **State:** Worktree changes are uncommitted and preserved. No push, deployment, persistent-database operation, or credential change occurred.

## Private evidence index

- [`security-review-coverage.md`](security-review-coverage.md): concise source-linked operation crosswalk and recommendation-to-regression index. [`security-review-route-authorization-map.json`](security-review-route-authorization-map.json) maps all 62 in-scope operations across 36 decision families and lists eight excluded contract operations with reasons. [`security-review-recommendation-review-map.json`](security-review-recommendation-review-map.json) aligns all 19 recommendations with reviewer record IDs, outcomes and explicit scope/status limitations. [`security-review-coverage-index.test.ts`](../apps/web/src/tests/unit/architecture/security-review-coverage-index.test.ts) checks both maps against the crosswalk/index and verifies exact OpenAPI set equality, source/test paths and relative links. Reviews 30–32 report examination of all 62 mapped operations in separate partitions; review 29 covered logout revocation. Review 32 found an inaccurate restore-revision description and missing negative-case test groups. Supplemental local model assessment 35 later checked those post-review corrections and regression additions against source; it found no actionable authorization defect and did not run tests. It is not counted as independent review evidence. Its Restore source line citation was offset and was checked against the actual method. Reviewer limitations and transport/billing caveats are retained privately. The architecture test proves inventory/reference structure, not authorization correctness.
- `IDENTITY-TRACE.md`: source-linked Vault and user-crypto operation inventory, actor derivation, and final repository access decisions, including sync and lifecycle paths.
- `SURFACE-TRACE.md`: invitations, key rotation, archive flows, browser storage/cache, logs, migrations, and release controls.
- `REMEDIATION.md`: recommendation outcomes, local fixes, regression evidence, independent-review scopes, and unresolved facts.
- `REPORT.md` and `run-metadata.json`: final handoff and machine-readable run status.
- Qualifying independent review records: `INDEPENDENT-REVIEW-27.txt`, `-28.txt`, `-29.txt` through `-32.txt`, `INDEPENDENT-REVIEW-36-RESTORE-PERSONAL-ACCOUNT.txt`, `INDEPENDENT-REVIEW-37-SYNC-ISOLATION.txt`, and `INDEPENDENT-REVIEW-38-FINAL-FIX-VERIFICATION.txt`. Reviews 30–32 partitioned the 62 route decisions; review 29 covered logout revocation. Reviews 36 and 37 identified test-coverage gaps but no authorization implementation defect; review 38 confirmed the gap-fix tests address them. Review 31's operation-range headings are imprecise around participant/invitation routes. These are bounded reports, not a comprehensive audit or hosted review.
- Supplemental local model output `LOCAL-MODEL-ASSESSMENT-35-NOT-INDEPENDENT.txt` checked the later wording and regression additions, but the completion auditor did not accept a locally installed model as the required independent reviewer. It is not counted toward that requirement. Exploratory local model attempts 33 and 34 are also not counted.

### Independent reviewer artifacts (private; digest-checked)

These are the bounded independent reviewer records, not map-only summaries. The records remain outside the repository; their SHA-256 values are duplicated here so a reader with authorized private evidence can verify the exact bytes. Reviews 30–32 cover all 62 operation rows in partitions; review 29 covers logout revocation. Reviewers inspected source and test assertions but did not execute tests. Review 31's participant/invitation range headings remain imprecise. Passing tests are separate execution evidence.

| Private report                                       | Scope and result                                                                                | SHA-256                                                            |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `INDEPENDENT-REVIEW-29.txt`                          | Logout revocation fix; no actionable implementation issue; did not run tests.                   | `de83249f4dad64d10b3546807dba3b60d0dfc16d0da3c5b34cae4060098cbab4` |
| `INDEPENDENT-REVIEW-30.txt`                          | Operations 1–24; no authorization defect reported.                                              | `50a01ecab3d2d4e2170cd219dbba808b51ae3120c535db0ecc462265b2fce16a` |
| `INDEPENDENT-REVIEW-31.txt`                          | Operations 25–51; no authorization defect reported; range headings are qualified in the report. | `287f8d789c364a6a86ced3e0e53d6b67e31571f747b739d4b9fb236b78e180f4` |
| `INDEPENDENT-REVIEW-32.txt`                          | Operations 52–62; restore wording/test-coverage gaps identified.                                | `3447c7df1fe75c6fe99f3d9b411004732e2e109d10084ad918552f5d2405ed42` |
| `INDEPENDENT-REVIEW-36-RESTORE-PERSONAL-ACCOUNT.txt` | Restore source and cross-owner regression; one Low test gap identified.                         | `48e07b3d6a7e04e04605baef403bdd868d36583392b6e879e2173c3096dcb3c4` |
| `INDEPENDENT-REVIEW-37-SYNC-ISOLATION.txt`           | Sync isolation source and regression; two test-coverage gaps identified.                        | `d7cce27f396243dec73be000278272b43116f55d2b35c9dbc0a8479452d45c2b` |
| `INDEPENDENT-REVIEW-38-FINAL-FIX-VERIFICATION.txt`   | Verified review 36/37 test-gap fixes; no further actionable gap.                                | `c857e26159433ad06d8ffa561f9d44656118ebd4a3ec435067eb54e54dc8dcbb` |

### Supplemental local model assessment (not qualifying independent review)

`LOCAL-MODEL-ASSESSMENT-35-NOT-INDEPENDENT.txt` is raw output from `google/gemma-4-e2b` through LM Studio with catalog fetching disabled. It reported no actionable authorization defect in the bounded post-review-32 wording and regression changes, but had an offset Restore line citation. The completion auditor did not accept this local-model pass as the required independent reviewer. It did not run tests and is retained only as supplemental evidence; its digest is `a7ec296d59f1f7c8ed4055485828f7215d385c3cf2f447d3cf6b99745b435ea6`.

## Inspectable evidence for the final fixes

The detailed reviewer reports and complete raw test logs remain private. This section publishes concise, source-linked reviewer findings and sanitized output excerpts so review status and test outcomes do not depend on access to the private audit directory. Report hashes are listed above; they identify the retained full reports but do not replace the excerpts below.

### Independent reviewer findings

- **Review 36 — Restore:** “The Restore description matches the code” and Restore has no expected-revision predicate. It found one test gap, not an implementation defect: no foreign owner tried to Restore the real owner’s deleted account. The regression now calls `Restore` as the foreign actor against that account and queries the row to confirm it remains deleted. Inspect `apps/api/internal/repository/authenticator_account_personal_account_repository.go:255–270` and `apps/api/internal/repository/authenticator_account_personal_account_repository_test.go:96–181`.
- **Review 37 — sync:** “The reader’s SQL correctly scopes shared Vaults to the supplied user ID and active memberships”; no authorization error was reported. It identified two test gaps: ciphertext fixtures were indistinguishable, and no active Viewer control existed. The test now asserts distinct synthetic profile/Vault/account/key-wrap values in both response forms, includes an active Viewer, and excludes a revoked Viewer. Inspect `apps/api/internal/repository/sync_workspace_bundle_reader.go:342–360` and `apps/api/internal/repository/sync_workspace_bundle_reader_test.go:14–185`.
- **Review 38 — follow-up:** “Both findings are addressed with no further actionable gap.” It confirmed the real-owner Restore attempt leaves the account deleted and the sync assertions distinguish values, response forms, and active/revoked Viewer behavior. All three reviewers were read-only and explicitly did not run tests. Review transport and billing are unobservable; no local/free-processing claim is made.

### Targeted test output

The following excerpts are from the targeted run against a verified run-owned synthetic PostgreSQL database. The run's container, data volume, and network were removed and verified absent. Raw-log SHA-256: `b3987d2188af1f7ae95d0ea5953e9fff71256986525052d7c1648454926d300d`.

Command (from `apps/api`):

```sh
go test -p=1 ./internal/repository -run '^(TestPersonalAccountRepositoryRejectsCrossOwnerAndCrossVaultTargets|TestWorkspaceBundleReaderIsolatesActorsAndExcludesInactiveMemberships)$' -count=1 -v
```

```text
=== RUN   TestPersonalAccountRepositoryRejectsCrossOwnerAndCrossVaultTargets
--- PASS: TestPersonalAccountRepositoryRejectsCrossOwnerAndCrossVaultTargets
=== RUN   TestWorkspaceBundleReaderIsolatesActorsAndExcludesInactiveMemberships
--- PASS: TestWorkspaceBundleReaderIsolatesActorsAndExcludesInactiveMemberships
PASS
ok   github.com/nooroctavian/rhasia-scret/apps/api/internal/repository
```

The linked coverage-index architecture test also passed 4/4 in the focused run and in the full gate; the root log identifies `src/tests/unit/architecture/security-review-coverage-index.test.ts` as 4 tests passed.

### Fresh root-gate output

Command: `pnpm run test:full` under Node 24.19.0 / Go 1.27.4, `CI` unset, a clean `env -i`, repository `.env` reads blocked, and the wrapper-owned disposable PostgreSQL Testcontainer. **Exit code: 0.** The raw log is retained privately; SHA-256: `d0278ee612273bbd6f1a36a4e817a856f974cd757f8b3978ccd5d80d72f037c3`.

Sanitized result excerpt:

```text
No vulnerabilities found.
client-vault-core: 16 test files, 91 tests passed
api-test-tools: 1 test file, 6 tests passed
api-contract: 2 test files, 10 tests passed
api-client: 1 test file, 2 tests passed
Web: 162 test files, 764 tests passed
Chromium smoke: 33 passed; E2E: 9 passed; PWA: 14 passed
Vault route bundles (all four): 745263 raw / 226877 gzip bytes
Disposable PostgreSQL Testcontainer and data volumes removed and verified absent.
Run-owned Sqitch test image removed and verified absent.
```

The repository can independently rerun the commands and inspect the linked test/source paths. The excerpts omit unrelated logs and environment values; they do not claim hosted or deployed verification.

## Final local verification

A root `pnpm run test:full` passed after the 62-operation maps, logout revocation fix, initial Restore decision correction, and initial Personal Account/sync regressions. Reviews 36 and 37 later identified test-coverage gaps in those regressions; they were addressed, and review 38 confirmed the fixes. The inspectable evidence section above records the targeted command and output, review dispositions, full-gate exit status, and sanitized pass summaries directly in this repository. A fresh root full gate was rerun after adding that section and passed with the same test totals. It used Node 24.19.0, Go 1.27.4, `CI` unset, a clean environment blocking repository `.env` reads, and the verified disposable PostgreSQL Testcontainer wrapper. Raw reviewer/test logs remain private to avoid publishing unrelated diagnostics. Earlier failed attempts and their disposable-resource cleanup are documented in the private run record.

- Final gate `govulncheck`: passed; no vulnerabilities found. Web: 162 files / 764 tests; client core: 16 / 91; API tools: 1 / 6; API contract: 2 / 10; API-client: 1 / 2; all Go packages passed.
- Lint, typecheck, format, architecture, production build, client-output and performance checks passed. The existing dependency-cruiser missing-TypeScript-transpiler warning remains; no dependency violations were reported.
- The full gate exercised the route-map coverage test, the new disposable PostgreSQL foreign-owner/cross-Vault Personal Account regression, the two-user sync bundle isolation regression (including revoked membership), and the logout handler's error-detail assertions. The focused logout Go handler test also passed separately.
- All four Vault routes measured 745,263 raw / 226,877 gzip bytes, within 750,000 / 227,000 limits.
- Chromium smoke 33/33, E2E 9/9, PWA 14/14 passed. Disposable Testcontainer, data volumes and Sqitch image were verified absent after teardown.

The full raw log remains private. This index keeps the command, exit status, sanitized result excerpt, and log digest in the repository; it does not rely on outside files for the summary. The terminal log concluded with:

```text
No vulnerabilities found.
apps/web test:full: Done
Disposable PostgreSQL Testcontainer and data volumes removed and verified absent.
Run-owned Sqitch test image removed and verified absent.
```

The raw log remains private to avoid moving detailed audit/test output into the repository; the sanitized, result-bearing excerpt above is the in-repository verification record.

## Post-review-32 independent review and remediation

- Reviews 36 and 37 compared the Restore wording and regression assertions with handler/repository source. Review 36 found a Low test gap: no foreign owner attempted Restore against the actual owner's Vault and deleted account. The test now performs that attempt and verifies the account remains deleted.
- Review 37 found two sync-test gaps, not an authorization implementation defect: ciphertext fixtures were identical and the revoked Viewer had no active Viewer control. The regression now gives distinct synthetic encrypted values to each user's crypto profile, Personal Vault, shared Vault, member key wrap and account; it asserts exact values in both response shapes. It also verifies an active Viewer appears and a revoked Viewer is excluded.
- Review 38 independently rechecked those test changes against source and confirmed both findings are addressed with no further actionable gap. It did not run tests. The two named Go regression tests passed separately against the verified disposable PostgreSQL run; the fresh root gate is separate execution evidence.
- Reviewer transport/billing telemetry remains unavailable. No claim is made that processing was local or free. Hosted/deployed controls remain separate and unverified.

## Outcome classes

- **Fixed locally:** previously reviewed repository findings have targeted regression coverage, including proxy log redaction, environment-file exclusions, offline-shell isolation, session/Vault cleanup and cache isolation, invitation/fragment handling, archive replay authorization, and bounded PWA polling.
- **Current follow-up verified locally:** the CUX-22/23 logout false-success path returns generic 503 after cookie clearing when token verification or revocation fails. Independent bounded review found no actionable implementation issue; focused Go regression and the final root full gate pass. Hosted revocation behavior remains unverified.
- **Already satisfied / non-findings:** source tracing found authenticated Vault routes apply owner or membership scope at final resource decisions. Personal Account audit requirements apply to create/update; delete/restore are not classified as defects. Empty archive imports remain an API-contract limitation.
- **Unverified / follow-up:** hosted branch protections, provider-key scope, database grants, logging/retention, ingress/trusted-proxy and aggregate poll capacity, deployed artifact identity, true-device PWA behavior, complete external scanner coverage, and reviewer transport/billing telemetry remain unverified. The PWA client does not honor API `Retry-After` on 429/503; server rate limits still apply, so this is a bounded rejected-request/resilience concern, not a demonstrated bypass.

No repository summary here substitutes for hosted evidence or a security clearance. The private ledger retains the complete evidence and exact remaining owner-supplied next steps.
