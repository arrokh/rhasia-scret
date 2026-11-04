# Dependency security triage — 2026-11-04

Scope: Dependabot alerts 36–38 in `arrokh/rhasia-scret`.

## Glob: GHSA-3g3m-2fjr-6pw4 (alert 37)

Upgrade `archiver-utils`' transitive `glob` from 10.5.0 to 14.0.3 with a scoped pnpm override. The fixed release is 14.0.2 or later. This crosses a major-version boundary, but the repository's Node 24 satisfies the engine requirement and archiver-utils uses the retained CommonJS `glob.sync` API.

Regression coverage in `tools/dependency-security.test.mjs` exercises real archiver-utils include/exclude expansion and verifies that both promise and stream traversal stop directory reads after cancellation. The full test gate also exercises the Testcontainers consumer.

Source: <https://github.com/advisories/GHSA-3g3m-2fjr-6pw4>.

## Minimatch: GHSA-g3hv-75wg-m249 (alert 38)

Upgrade all modern v9/v10 callers to 11.0.4; the first fixed release is 11.0.1. Tests cover the upstream pattern-amplification and large-set deduplication regressions.

Keep legacy minimatch 3.1.5 and 5.1.9 for ESLint plugins and archiver's readdir-glob respectively. These use the callable CommonJS API, which modern minimatch no longer exports. The reported vulnerability is in `firstPhasePreProcess` and `secondPhasePreProcess` at optimization level 2. Those methods do not exist in these legacy implementations. Tests assert this distinction and preserve their callable API. Do not globally override legacy consumers to v11: that breaks their API.

The advisory currently declares every version below 11.0.1 vulnerable, so package-only audit tools still report the legacy copies. After upgrading the actually affected modern copies, any residual alert for these legacy copies is classified as an inaccurate applicability range, not an unpatched reachable implementation of the reported flaw. This classification applies only to this advisory, not future minimatch advisories. Revisit if upstream changes its technical description or these consumers change implementation.

Sources:

- <https://github.com/advisories/GHSA-g3hv-75wg-m249>
- <https://github.com/isaacs/minimatch/commit/77a0f5c4b80bdc641c3c930a1d9edf5ad2db57f8>

## Deepmerge: GHSA-gcqx-w48m-w2h4 (alert 36)

No patched deepmerge release is available; npm still lists 4.3.1 as latest. It is used by the shadcn development CLI and its registry package, not application merge workflows.

The assigning CNA rejected CVE-2026-93753 on 2026-11-02. Its authoritative record states: “This CVE ID has been rejected because it does not describe a security vulnerability.” GitHub's advisory was still active when checked on 2026-11-04. Classify this alert as inaccurate based on the CNA rejection, rather than claiming an upstream fix, downgrading, replacing the merge implementation, or altering UI tooling solely to satisfy stale advisory metadata.

Sources:

- <https://cveawg.mitre.org/api/cve/CVE-2026-93753>
- <https://github.com/advisories/GHSA-gcqx-w48m-w2h4>

## Audit policy

No audit exclusions, secret-scanning exceptions, or CI thresholds are changed. `pnpm audit` can continue to report the disputed deepmerge advisory and the legacy minimatch applicability mismatch until advisory metadata is corrected. Production dependencies must continue to pass the existing audit gate. Any GitHub alert dismissal must link this triage and explain the precise reason; it is not evidence of a new patched release.
