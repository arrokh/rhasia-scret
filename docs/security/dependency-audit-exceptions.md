# Dependency audit exceptions

The CI dependency audit fails closed for every new advisory except the two
currently unpatched `image-size` advisories listed below. pnpm records these
exceptions in `pnpm-workspace.yaml` under `auditConfig.ignoreGhsas`.

| Advisory | Package | Dependency path | Reason | Owner | Review by |
| --- | --- | --- | --- | --- | --- |
| [GHSA-w3rx-r6r6-pgpr](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr) | `image-size` 1.2.1 | Expo/Metro mobile build tooling | The advisory's patched version is `>=2.0.3`, but the registry currently provides no `2.0.3` release. The current Metro dependency requires the `1.x` API range. | Repository maintainers | 2026-09-13 |
| [GHSA-5p2g-fcmc-qvqq](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq) | `image-size` 1.2.1 | Expo/Metro mobile build tooling | Same upstream release and compatibility constraint as above. | Repository maintainers | 2026-09-13 |

The exception is limited to the mobile build-tool dependency chain; it does
not authorize vulnerable versions in application runtime dependencies. Remove
both identifiers from `auditConfig.ignoreGhsas` and regenerate the lockfile as
soon as Metro or `image-size` publishes a compatible patched release. Re-run
`pnpm audit --prod --audit-level=high` before changing the review date.
