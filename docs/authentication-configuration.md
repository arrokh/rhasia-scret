# Supabase authentication configuration

Slice 1 uses administrator-invited, passwordless email authentication. Configure every Supabase project before deployment:

1. Disable public email signup in **Authentication → Providers → Email**. Administrators create users through the Supabase Auth invitation flow; the application does not provide registration.
2. Set the Site URL and permitted redirect URLs to include `https://<application-host>/auth/confirm` (and the local development equivalent).
3. Use the Supabase email template that redirects a recipient to `/auth/confirm?token_hash={{ .TokenHash }}&type=email`, as prescribed by the current Supabase Auth template documentation. The route verifies that token hash and establishes a cookie-backed session. It also supports the standard PKCE `code` callback shape used by Supabase SSR clients.
4. Keep email OTP/magic-link rate limits and expiry at Supabase-managed defaults unless an administrator approves a change. The application does not implement an authentication-attempt limiter.

The browser always sends `shouldCreateUser: false` when requesting a link. Runtime behavior and the Supabase project setting are both required: the former prevents accidental client-side creation attempts; the latter ensures the Auth service does not accept public registrations from another client.

A verified server-side session is the only input to application-user provisioning. No `allowed_emails` table, application invitation endpoint, or in-app user-management UI is permitted.
