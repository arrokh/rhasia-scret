# Supabase authentication configuration

Slice 1 uses administrator-invited, passwordless email authentication. Configure every Supabase project before deployment:

1. Disable public email signup in **Authentication → Providers → Email**. Administrators create users through the Supabase Auth invitation flow; the application does not provide registration.
2. Set the production Site URL to `https://rhasia-scret.vercel.app/` and add both permitted redirect URLs: `https://rhasia-scret.vercel.app/auth/confirm` and `http://localhost:3000/auth/confirm`. The browser sends `emailRedirectTo` as `${window.location.origin}/auth/confirm`; therefore local sign-in uses localhost and production sign-in uses the deployed origin without trusting a user-supplied redirect.
3. Use a magic-link template that preserves the requested environment-specific redirect: `<a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=email">Sign in</a>`. The route verifies that token hash and establishes a cookie-backed session, then sends the user to `/vaults`. It also supports the standard PKCE `code` callback shape used by Supabase SSR clients. If the default `{{ .ConfirmationURL }}` template is used instead, keep the same two callback URLs in the Supabase allowlist; `emailRedirectTo` is encoded into that generated confirmation URL. Do not hardcode `{{ .SiteURL }}` in the custom link, or local requests will be sent to production.
4. Keep email OTP/magic-link rate limits and expiry at Supabase-managed defaults unless an administrator approves a change. The application does not implement an authentication-attempt limiter.

The browser always sends `shouldCreateUser: false` when requesting a link. Runtime behavior and the Supabase project setting are both required: the former prevents accidental client-side creation attempts; the latter ensures the Auth service does not accept public registrations from another client.

A verified server-side session is the only input to application-user provisioning. No `allowed_emails` table, application invitation endpoint, or in-app user-management UI is permitted.

## Route protection and logout

The application continues to use Supabase Auth through `@supabase/ssr`; adding a second Auth.js/NextAuth session system would conflict with the invite-only Supabase identity boundary in ADR-0011. The Next.js 16 `proxy.ts` follows the current Supabase SSR guidance: it calls `getClaims()` to refresh and optimistically verify cookie-backed sessions, copies refreshed cookies to the request and response, and redirects unauthenticated protected-page requests to `/sign-in?auth=required`. Page and API authorization checks remain close to their data sources because Proxy is not a sufficient authorization boundary.

Route inventory:

- Public pages and support routes: `/` is the product landing page for every visitor; `/sign-in` owns invite-only authentication and redirects an active authenticated user to `/vaults`; `/auth/confirm`; `/auth/logout` (POST only, so stale sessions can be cleared); `/smoke`; and the development-only `/ui-preview` fixture.
- Protected pages: `/vaults` and descendants, plus `/totp`.
- Public APIs: `/api/health` and `/api/time`; neither returns user or vault data.
- Every other application API verifies the Supabase session in its route handler and applies its existing resource-authorization checks before accessing data.

Logout is submitted as a same-origin `POST /auth/logout`; requests with a missing or different `Origin` are rejected to prevent forced-logout CSRF. It calls `supabase.auth.signOut({ scope: "local" })` on the server so only the current browser session is terminated, SSR auth cookies are cleared through the cookie adapter, and sessions on the user's other devices remain active. Missing or already-expired sessions are treated idempotently. The endpoint redirects to the sign-in page with a redacted success or failure state and never exposes provider errors.
