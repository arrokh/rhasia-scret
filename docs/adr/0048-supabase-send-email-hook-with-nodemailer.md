# ADR-0048: Server-controlled passwordless email delivery (superseded)

- Status: Superseded by ADR-0049
- Date: 2026-09-13

This decision described a former email-delivery integration and is retained only as historical context. The current application no longer delegates authentication links, sessions, or delivery authorization to an external authentication service.

The current self-managed passwordless implementation keeps email delivery server-only. Bun, self-hosted Node.js, and Vercel API runtimes use the same Nodemailer/SMTP adapter and configuration. SMTP submission uses port 465 or 587; port 25 remains prohibited. The adapter never disables TLS certificate validation. The application creates one-time challenge records, stores HMAC digests rather than raw tokens, validates bounded return paths and client audiences, sends a bilingual message, and redeems the fragment token into a local database session. Delivery failures are generic to callers and sensitive values never enter logs, caches, analytics, or client state.

See [ADR-0049](0049-self-managed-passwordless-authentication.md) for the current identity, session, migration, rotation, revocation, and rate-limit contract.
