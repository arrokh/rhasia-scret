# Keep Turnstile key pairing at the self-hosted installer

- Status: Accepted
- Date: 2026-10-01
- Supersedes: ADR-0057

The Web runtime owns `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and renders the challenge; the API runtime owns only `TURNSTILE_SECRET_KEY` and validates submitted tokens. Independently deployed services must not require or receive each other's key, so API deployment and runtime validation checks only the server secret. The self-hosted installer configures both services together and therefore requires the site key and secret to be either both present or both absent. When the API secret is configured, the API continues to require and validate a submitted Turnstile token before rate limiting or magic-link work; without it, server-side challenge validation is disabled and database-backed abuse limits still apply.
