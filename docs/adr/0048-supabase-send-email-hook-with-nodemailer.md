# ADR-0048: Server-controlled passwordless email delivery (superseded)

- Status: Superseded by ADR-0049
- Date: 2026-09-13

This decision described a former email-delivery integration and is retained only as historical context. The current application no longer delegates authentication links, sessions, or delivery authorization to an external authentication service.

At the time this decision was superseded by ADR-0049, self-managed passwordless email delivery remained server-only and used a Nodemailer/SMTP adapter in the then-current TypeScript API. That API was later replaced by Go/Echo; the current Go SMTP transport and Indonesian-default/English-selectable email behavior are described in [passwordless authentication configuration](../authentication-configuration.md). The server-side challenge, digest-only token persistence, bounded routing hints, generic delivery failures, and sensitive-data restrictions remain applicable.

See [ADR-0049](0049-self-managed-passwordless-authentication.md) for the current identity, session, migration-history, rotation, revocation, and rate-limit contract.
