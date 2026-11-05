# Secret scan exceptions

The repository secret scan remains enabled for pull requests, pushes to
`main`, manual runs, and the scheduled full-history scan. The allowlist in
[`.gitleaks.toml`](../../.gitleaks.toml) is commit-scoped so it does not mask
future findings in the affected files or branches.

These exceptions do not permit adding user-provided data to tests or fixtures.
All automated tests, examples, and reproductions must use synthetic, non-PII
values such as reserved example domains and dummy labels; redact real account
labels, issuer names, URIs, QR payloads, credentials, and tokens before commit.

| Historical commit                          | Finding                                                                            | Reason                                                                        | Owner                  | Review by  |
| ------------------------------------------ | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------- | ---------- |
| `3736f553843242a06f8a76cbecab3d91bb3ed0c8` | Retention-purge test fixture in `src/tests/contract/retention-purge-route.test.ts` | Synthetic test-only bearer value; it is never used by a deployed environment. | Repository maintainers | 2026-10-16 |
| `f350d9c338a49a46fbd5c360038f176bf7cdde5a` | Retention-purge test fixture in `src/tests/contract/retention-purge-route.test.ts` | Synthetic test-only bearer value; it is never used by a deployed environment. | Repository maintainers | 2026-10-16 |

The synthetic fixture exceptions should be removed if those historical commits
are ever rewritten or the Gitleaks rule no longer reports them.
