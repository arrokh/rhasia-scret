# Invite-only email OTP authentication

- Status: Superseded by ADR-0043 for the Supabase deployment mode; retained as historical context

The MVP originally used Supabase email OTP or magic-link authentication only for users invited manually by an administrator through Supabase Auth. Supabase public signup was disabled; the application provisioned `application_users` from a verified invited-user session and had no separate `allowed_emails` table. The application had no in-app user-management surface, and the Vault Unlock Secret remained separate from authentication.

ADR-0039 preserved this behavior while moving the application contract to Verified Principal, External Identity, and independent Application Admission. ADR-0043 changes only the Supabase deployment mode to public passwordless email sign-in/signup with Confirm email enabled. OIDC and Local-only deployments do not rely on Supabase signup, and no provider-specific identity may cross the Identity boundary.
