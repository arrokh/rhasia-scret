# Supabase authentication configuration

The hosted Supabase deployment supports public, passwordless email authentication. Configure every Supabase project before deployment:

1. Enable public email signup and **Confirm email** in **Authentication → Providers → Email**. The web and native clients request a magic link with `shouldCreateUser: true`; Supabase creates the Auth user and the application provisions its Application User after the first verified session. The application does not use passwords or receive email secrets.
2. Set the production Site URL to the deployed web origin, for example `https://app.example.com/`, and add the web redirect URLs `https://app.example.com/auth/confirm` and `http://localhost:3000/auth/confirm`. Replace `app.example.com` with the operator's exact HTTPS origin. The browser sends `emailRedirectTo` as `${window.location.origin}/auth/confirm`; therefore local sign-in/signup uses localhost and production sign-in/signup uses the deployed origin without trusting a user-supplied redirect. Add the native production callback `${EXPO_PUBLIC_WEB_ORIGIN}/auth/mobile` and development custom callback only as documented in [`mobile-release-configuration.md`](mobile-release-configuration.md).
3. Use a magic-link template that preserves the requested environment-specific redirect: `<a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=email">Continue</a>`. The route verifies that token hash and establishes a cookie-backed session, then sends the user to `/vaults`. It also supports the standard PKCE `code` callback shape used by Supabase SSR clients. If the default `{{ .ConfirmationURL }}` template is used instead, keep the same two callback URLs in the Supabase allowlist; `emailRedirectTo` is encoded into that generated confirmation URL. Do not hardcode `{{ .SiteURL }}` in the custom link, or local requests will be sent to production.
4. Keep email OTP/magic-link rate limits and expiry at Supabase-managed defaults unless an administrator approves a change. The application does not implement an authentication-attempt limiter.

The web and native clients always send `shouldCreateUser: true` when requesting a link. Runtime behavior and the Supabase project setting are both required: the former enables this application's public email signup flow; the latter enables registration for the Supabase Auth provider. Confirmed email remains mandatory: server-side session verification rejects sessions whose `email_confirmed_at` is null.

A verified server-side session is the only input to application-user provisioning. Supabase-mode provisioning creates an Application User for a new verified principal; existing External Identity and Application User records are reused idempotently. Shared Vault invitations still bind to the exact invited email and do not grant access until the recipient redeems the one-time Secure Share Link. No `allowed_emails` table, separate registration-invitation endpoint, or in-app user-management UI is required for registration.

## Configuration failure behavior

Hosted deployments must treat missing or invalid authentication configuration as a deployment failure. The current web composition validates the selected backend and the Supabase session adapter rejects missing public Supabase values, but some page/proxy paths currently catch those errors and fall back to the `none` session boundary instead of rendering a localized configuration error. That behavior is an implementation gap, not a supported hosted-mode bypass; explicit fail-closed configuration errors are tracked in [#187](https://github.com/arrokh/rhasia-scret/issues/187) and remain required by the MVP acceptance criteria.

## Route protection and logout

The application continues to use Supabase Auth through `@supabase/ssr`; adding a second Auth.js/NextAuth session system would conflict with the Supabase identity boundary in ADR-0043. The Next.js 16 `proxy.ts` follows the current Supabase SSR guidance: it calls `getClaims()` to refresh and optimistically verify cookie-backed sessions, copies refreshed cookies to the request and response, and redirects unauthenticated protected-page requests to `/sign-in?auth=required`. Page and API authorization checks remain close to their data sources because Proxy is not a sufficient authorization boundary.

Route inventory:

- Public pages and support routes: `/` is the product landing page for every visitor; `/privacy` and `/support` publish the bilingual privacy and support disclosures; `/sign-in` owns passwordless email sign-in/signup and redirects an active authenticated user to `/vaults`; `/auth/confirm`; `/auth/logout` (POST only, so stale sessions can be cleared); `/smoke`; and the development-only `/ui-preview` fixture.
- Protected pages: `/vaults` and descendants, plus `/totp`.
- Public APIs: `/api/health` and `/api/time`; neither returns user or vault data.
- Every other application API verifies the Supabase session in its route handler and applies its existing resource-authorization checks before accessing data.

Logout is submitted as a same-origin `POST /auth/logout`; requests with a missing or different `Origin` are rejected to prevent forced-logout CSRF. It calls `supabase.auth.signOut({ scope: "local" })` on the server so only the current browser session is terminated, SSR auth cookies are cleared through the cookie adapter, and sessions on the user's other devices remain active. Missing or already-expired sessions are treated idempotently. The endpoint redirects to the sign-in page with a redacted success or failure state and never exposes provider errors.
