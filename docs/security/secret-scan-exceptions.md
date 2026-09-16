# Secret scan exceptions

The repository secret scan remains enabled for pull requests, pushes to
`main`, manual runs, and the scheduled full-history scan. The allowlist in
[`.gitleaks.toml`](../../.gitleaks.toml) is commit-scoped so it does not mask
future findings in the affected files or branches.

These exceptions do not permit adding user-provided data to tests or fixtures.
All automated tests, examples, and reproductions must use synthetic, non-PII
values such as reserved example domains and dummy labels; redact real account
labels, issuer names, URIs, QR payloads, credentials, and tokens before commit.

| Historical commit                          | Finding                                                                            | Reason                                                                                                                                                                        | Owner                  | Review by  |
| ------------------------------------------ | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ---------- |
| `dfed1a5deede8268710ac3d20d24b2e9715475a9` | Cloudflare Web Analytics token in `apps/web/src/app/layout.tsx`                    | Browser-visible analytics configuration; the active source reads the public `NEXT_PUBLIC_CLOUDFLARE_WEB_ANALYTICS_TOKEN` environment variable instead of embedding the value. | Repository maintainers | 2026-10-16 |
| `3736f553843242a06f8a76cbecab3d91bb3ed0c8` | Retention-purge test fixture in `src/tests/contract/retention-purge-route.test.ts` | Synthetic test-only bearer value; it is never used by a deployed environment.                                                                                                 | Repository maintainers | 2026-10-16 |
| `f350d9c338a49a46fbd5c360038f176bf7cdde5a` | Retention-purge test fixture in `src/tests/contract/retention-purge-route.test.ts` | Synthetic test-only bearer value; it is never used by a deployed environment.                                                                                                 | Repository maintainers | 2026-10-16 |

The Cloudflare value must remain treated as public analytics configuration,
not as a server credential. If its provider scope or privileges change, remove
the exception and rotate the value before changing the source or configuration.
The synthetic fixture exceptions should be removed if those historical commits
are ever rewritten or the Gitleaks rule no longer reports them.
