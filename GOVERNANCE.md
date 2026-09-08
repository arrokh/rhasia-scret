# Governance and maintenance

## Roles

- **Maintainer:** owns the repository, approves changes that affect security,
  licensing, release contents, or irreversible domain behavior, and may act as
  incident or release owner.
- **Reviewer:** checks the relevant bounded-context boundary, tests, security
  contract, localization parity, and documentation evidence. Reviewers do not
  self-approve their own sensitive changes.
- **Release owner:** assembles verification, provenance, dependency, native,
  deployment, and rollback evidence and records the launch or hold decision.
- **Deployment operator:** controls each hosted or self-hosted environment,
  provider account, production secret, backup, purge scheduler, and incident
  response for that deployment.

The current repository ownership is declared in [`.github/CODEOWNERS`](.github/CODEOWNERS).

## Triage

Maintainers review incoming issues regularly, label them as bug, feature,
documentation, security, or question, and record the relevant scope and
acceptance criteria. Reproduction uses synthetic data. A security issue is
removed from public discussion and handled under [`SECURITY.md`](SECURITY.md).
Stale requests may be closed with a reason and a link to the governing ADR or
replacement issue.

## Escalation

Escalate immediately to the maintainer when a change affects plaintext
boundaries, crypto or recovery, authentication or authorization, data
retention, analytics sanitization, provider contracts, release artifacts,
license/provenance, or a production incident. Freeze unrelated release work
when necessary to preserve evidence or limit exposure; do not weaken a
security control as a workaround.

## Vulnerability embargo

Vulnerability reports remain private while impact, fix, affected versions, and
operator actions are coordinated. The maintainer chooses disclosure timing in
consultation with the reporter where possible. Public issue templates redirect
security reports to the private GitHub Security Advisory channel and must not
collect sensitive details.

## Release approval

A release requires maintainer approval after the required CI checks pass and
the release owner has recorded the applicable full verification, dependency
license/provenance, secret scan, browser, deployment, and native evidence.
Production provider controls are not inferred from repository tests. A release
is held when a required check fails, a legal/provenance item is unresolved, a
security finding is unaccepted, or a rollback path is not documented.

The [roadmap](ROADMAP.md), [changelog](CHANGELOG.md), and [release-related
issues](https://github.com/arrokh/rhasia-scret/issues) are the public record of
planned and completed work.
