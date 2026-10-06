# Release readiness records

This directory contains versioned repository-release readiness records and historical readiness snapshots.

For a release candidate, the matching `vX.Y.Z.md` record is the source of its candidate-specific evidence. Each record applies only to its stated version, reviewed baseline SHA, and evidence timestamp. A `READY FOR HUMAN RELEASE REVIEW` decision supports human review of that candidate; it does not prove publication or establish readiness for a later release or the current deployment.

Confirm publication through the exact-source GitHub Release and workflow provenance described in the [release process](../release-process.md). A local tag, the current branch position, or an older readiness record is not a substitute.
