# Performance evidence

These versioned baselines compare latest `main` (`e17fcaa`) with the implementation measured on the original performance branch. New measurements are generated into ignored `test-results/performance/` and are not committed.

## Runtime measurements

- `baseline-navigation-production.json`: latest-main local production build.
- `baseline-route-bundles.json`: latest-main route chunk baseline.
- Current navigation and development reports belong under ignored `test-results/performance/`; development compilation latency is not a product budget.

Both production runs used the same local PostgreSQL database, Chromium profile, synthetic E2E identity, and machine. To exercise protected pages without production credentials, each measurement build was made in an isolated/local step that temporarily enabled the existing E2E session seam with `PERFORMANCE_TESTS=1`; the source file was restored immediately after compilation. The bypass is not present in the checked source or final production build.

The report contains only route names, counts, durations, transfer-independent timing, and safe Server-Timing values. It does not contain Vault Unlock Secrets, keys, OTPs, raw QR data, decrypted account content, or production identity data.

Run the durable development regression with:

```bash
pnpm run test:performance
```

A staging/preview production run can set `PERFORMANCE_EXTERNAL_SERVER=1`, `PERFORMANCE_BASE_URL`, and an appropriately provisioned test identity rather than enabling any production auth bypass.

## Bundle measurements

The versioned baseline is kept beside this README. The current route-bundle report is generated under ignored `test-results/performance/`.

Generate and enforce the implementation budgets after `pnpm run build` with:

```bash
pnpm run performance:bundles
```

The command writes `test-results/performance/route-bundles.json`.

## Rendered UI inspection

Rendered desktop/mobile inspection captures are generated as temporary local evidence and are not checked into the repository. The `/artifacts/` and `test-results/` ignore rules prevent one-off visual-debugging output from accumulating in source control.
