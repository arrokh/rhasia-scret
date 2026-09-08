# Dependency audit exceptions

The CI dependency audit fails closed for every new advisory except the two
currently unpatched `image-size` advisories listed below. pnpm records these
exceptions in `pnpm-workspace.yaml` under `auditConfig.ignoreGhsas`.

## September 2026 dependency remediation

The release-blocking advisories tracked by issues [#144](https://github.com/arrokh/rhasia-scret/issues/144) and [#154](https://github.com/arrokh/rhasia-scret/issues/154) are remediated in the lockfile through the following root overrides:

| Package | Resolved version | Reachability review |
| --- | --- | --- |
| `qs` | `6.16.0` | Transitive `express`/`body-parser` parsing dependency; no application code imports or directly configures `qs`. |
| `@xmldom/xmldom` | `0.8.15` for `@expo/plist`, `0.9.12` for `plist` | Expo/native build tooling only; no application code imports XML DOM APIs or serializes untrusted XML. The scoped overrides preserve each consumer's supported major/minor line. |
| `mysql2` | `3.23.1` | Prisma tooling dependency only; the application runtime uses the PostgreSQL adapter and does not enable the MySQL compressed protocol. |

Verification for the remediation branch:

```text
pnpm install --frozen-lockfile
pnpm audit --prod --audit-level=high  # No known vulnerabilities found
```

The remaining `image-size` exception is separate from these runtime advisories:
Metro's current `1.x` dependency range has no published compatible `2.0.3`
release, and the affected package is build tooling rather than a production
runtime dependency. Keep its owner and review date current until Metro or
`image-size` publishes a compatible patched release.

| Advisory | Package | Dependency path | Reason | Owner | Review by |
| --- | --- | --- | --- | --- | --- |
| [GHSA-w3rx-r6r6-pgpr](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr) | `image-size` 1.2.1 | Expo/Metro mobile build tooling | The advisory's patched version is `>=2.0.3`, but the registry currently provides no `2.0.3` release. The current Metro dependency requires the `1.x` API range. | Repository maintainers | 2026-09-13 |
| [GHSA-5p2g-fcmc-qvqq](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq) | `image-size` 1.2.1 | Expo/Metro mobile build tooling | Same upstream release and compatibility constraint as above. | Repository maintainers | 2026-09-13 |

The exception is limited to the mobile build-tool dependency chain; it does
not authorize vulnerable versions in application runtime dependencies. Remove
both identifiers from `auditConfig.ignoreGhsas` and regenerate the lockfile as
soon as Metro or `image-size` publishes a compatible patched release. Re-run
`pnpm audit --prod --audit-level=high` before changing the review date.
