# Project support

## Choose the right channel

- **How-to and self-hosting:** start with the [documentation index](README.md)
  and [self-hosting guide](self-hosting.md). A self-hosted operator owns its
  provider, deployment, database, backup, and retention support.
- **Reproducible bug:** use the [bug report template](../.github/ISSUE_TEMPLATE/bug_report.yml).
  Include the commit or release, browser or native platform, and synthetic
  reproduction steps. Do not include Vault content or credentials.
- **Feature or documentation request:** use the matching public template. Keep
  proposals focused on product behavior, documentation, or maintainability.
- **Security vulnerability:** do not open a public issue. Use the private
  [GitHub Security Advisory form](https://github.com/arrokh/rhasia-scret/security/advisories/new)
  and follow [`SECURITY.md`](../SECURITY.md).
- **Hosted-demo account or deletion request:** contact the operator of the
  deployment. Repository maintainers cannot inspect a self-hosted operator's
  database or recover Vault content.

## Safe support reports

Support reports may include redacted error codes, timestamps, route names,
release/commit identifiers, and synthetic IDs. Never include passwords,
passphrases, OTPs, TOTP secrets, QR data, Secure Share Link fragments, cookies,
authorization headers, provider tokens, database URLs, archive keys, or
decrypted Vault content. Screenshots must be redacted before upload.

## Triage and escalation

Maintainers label incoming requests as bug, feature, documentation, security,
or question; reproduce them with synthetic data; and link the relevant ADR or
issue. Security reports follow the embargo and disclosure process in
[`SECURITY.md`](../SECURITY.md). Release-blocking changes are escalated to the
maintainer before deployment or merge.

The Indonesian companion is [`support.id.md`](support.id.md).
