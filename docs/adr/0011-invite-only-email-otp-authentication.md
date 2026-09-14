# Invite-only email authentication (superseded)

- Status: Superseded by ADR-0049; retained as historical context
- Date: 2026-03-01

The MVP originally considered administrator-invited email-link authentication. That policy was later replaced by seamless self-managed passwordless sign-in/signup: any user can request a link, while Shared Vault access remains governed by explicit invitations and membership authorization.

The current system still preserves the important boundaries from this decision: authentication is distinct from the Vault Unlock Secret, there is no password registration or `allowed_emails` table, application-user provisioning is idempotent, and a valid authentication session does not grant Shared Vault membership.
