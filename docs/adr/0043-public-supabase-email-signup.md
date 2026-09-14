# ADR-0043: Public passwordless email signup (superseded)

- Status: Superseded by ADR-0049
- Date: 2026-08-12

This decision described a former hosted authentication implementation. It is retained only as an historical record of why seamless email-link sign-in and account creation were preferred over a visible signup distinction.

The current implementation does not use the former external authentication service or its signup configuration. Self-managed passwordless authentication now issues one-time fragment links, stores only challenge digests, provisions provider-neutral `ExternalIdentity` rows, creates local database sessions, rotates refresh credentials, and applies database-backed anonymous abuse limits. See [ADR-0049](0049-self-managed-passwordless-authentication.md) and [`authentication-configuration.md`](../authentication-configuration.md).

The current system preserves the original product decisions: no password registration, no `allowed_emails` table, no visible account-existence distinction, no automatic email linking, and no sharing of Vault plaintext with the authentication layer.
