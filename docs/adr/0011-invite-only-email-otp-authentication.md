# Invite-only email OTP authentication

- Status: Superseded for provider boundaries by ADR-0039; retained for the Supabase deployment mode.

The MVP uses Supabase email OTP or magic-link authentication only for users invited manually by an administrator through Supabase Auth. Supabase public signup is disabled; the application provisions `application_users` from a verified invited-user session and has no separate `allowed_emails` table. The application has no in-app user-management surface in the MVP, and the Vault Unlock Secret remains separate from authentication.

ADR-0039 preserves this behavior as `AUTH_BACKEND=supabase` while moving the application contract to Verified Principal, External Identity, and independent Application Admission. OIDC and Local-only deployments do not rely on Supabase administrator invitations, and no provider-specific identity may cross the Identity boundary.
