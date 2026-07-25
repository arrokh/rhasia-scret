# Invite-only email OTP authentication

The MVP uses Supabase email OTP or magic-link authentication only for users invited manually by an administrator through Supabase Auth. Supabase public signup is disabled; the application provisions `application_users` from a verified invited-user session and has no separate `allowed_emails` table. The application has no in-app user-management surface in the MVP, and the Vault Unlock Secret remains separate from authentication.
