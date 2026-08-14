# Public Supabase passwordless email signup

- **Status:** Accepted
- **Date:** 2026-08-14
- **Related:** ADR-0011, ADR-0031, ADR-0039, ADR-0042

## Context

The hosted web and mobile clients use Supabase passwordless email links. The original deployment was invite-only and passed `shouldCreateUser: false`, while the Supabase project is now configured to allow new users and confirm email. Leaving the clients in invite-only mode would make the provider setting ineffective for the product and would leave users without a public registration path.

## Decision

The `supabase` deployment mode supports public passwordless email sign-in and signup:

- Web and mobile clients call `signInWithOtp` with `shouldCreateUser: true`.
- The same email-link flow signs in an existing user or asks Supabase Auth to create a new user.
- Supabase **Confirm email** remains enabled. The callback establishes the SSR/native session only through the approved redirect, and server verification rejects an unconfirmed email.
- The server provisions one Application User and External Identity idempotently for a new verified Supabase principal. The Application User identifier and all encrypted content remain provider-independent and client-encrypted.
- OIDC admission remains separately governed by configured admitted emails or a pending Shared Vault invitation.
- Shared Vault invitations remain exact-email authorization metadata and one-time key-delivery workflows; signup does not itself grant Shared Vault membership.

The public browser and native clients do not collect passwords, receive confirmation tokens outside the provider callback, expose provider errors, or place session values in application state intended for encrypted content.

## Redirect and provider configuration

Every deployed origin used by the clients must be an explicit Supabase Auth redirect URL. The web callback is `/auth/confirm`; native production and development redirects are configured by the mobile release documentation. Custom email templates must preserve the requested `RedirectTo` value rather than hardcoding the production Site URL.

## Consequences

Public signup changes the hosted Application Admission policy from administrator pre-registration to verified-email admission for Supabase. Authentication remains distinct from Shared Vault authorization, and unverified or revoked sessions fail closed. Supabase Auth rate limits email-link requests; the application does not duplicate that provider-owned limiter.

The former invite-only behavior is retained only as historical context in ADR-0011. Product copy, tests, deployment configuration, and mobile UI must describe verified-email sign-in/signup rather than administrator invitation.
