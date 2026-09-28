# Dependency audit exceptions

## Current policy

There are no ignored dependency advisories. The root `pnpm audit --prod --audit-level=high` check fails closed for every high or critical advisory. Do not add an audit exception without a concrete dependency path, security review, owner, and dated removal condition.

## Current exception review register

| Active advisories | Owner | Review by |
| ----------------- | ----- | --------- |
| None              | N/A   | N/A       |

## Historical remediation and retired exceptions

Issues [#144](https://github.com/arrokh/rhasia-scret/issues/144) and [#154](https://github.com/arrokh/rhasia-scret/issues/154) remediated dependency advisories with lockfile overrides, including `qs` `6.16.0`, `mysql2` `3.23.1`, and scoped `@xmldom/xmldom` overrides used by Expo/plist tooling. The Expo-only XML dependency and overrides were removed when the native application was retired under ADR-0054; the `qs` and `mysql2` overrides remain for their current dependency paths.

The former Expo/Metro dependency chain also required temporary `image-size` exceptions for [GHSA-w3rx-r6r6-pgpr](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr) and [GHSA-5p2g-fcmc-qvqq). Issue #243 removed that toolchain and its resolved `image-size` dependency, so both advisory IDs were removed from `pnpm-workspace.yaml` rather than retained as dormant ignores. The current lockfile contains no `image-size` or `@xmldom/xmldom` package entry. If either dependency is reintroduced, evaluate its current advisory status and compatibility from scratch; do not restore the historical exceptions automatically.

Verify the current dependency graph and policy with:

```bash
pnpm install --frozen-lockfile
pnpm audit --prod --audit-level=high
pnpm run verify:dependency-licenses
```
