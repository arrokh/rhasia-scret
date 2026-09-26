import type { ApplicationRateLimitPolicyId } from "../domain/application-rate-limit-policy";

export const AUTHENTICATED_MUTATION_RATE_LIMIT_POLICIES = {
  "POST /api/v1/me/deletion/otp/request": "account_deletion_authentication",
  "POST /api/v1/me/deletion/otp/verify": "account_deletion_authentication",
  "DELETE /api/v1/me": "destructive_mutation",
  "POST /api/v1/passkey-recovery/authentication/options": "recovery_authentication",
  "POST /api/v1/passkey-recovery/authentication/verify": "recovery_authentication",
  "POST /api/v1/passkey-recovery/registration/options": "recovery_mutation",
  "POST /api/v1/passkey-recovery/registration/verify": "recovery_mutation",
  "DELETE /api/v1/passkey-recovery": "recovery_mutation",
  "POST /api/v1/personal-vault/destructive-reset": "destructive_mutation",
  "POST /api/v1/personal-vault/initialize": "key_material_mutation",
  "POST /api/v1/secure-share-links": "membership_mutation",
  "POST /api/v1/shared-vaults/[vaultId]/accounts": "account_mutation",
  "PATCH /api/v1/shared-vaults/[vaultId]/accounts": "account_mutation",
  "DELETE /api/v1/shared-vaults/[vaultId]/accounts": "account_mutation",
  "PUT /api/v1/shared-vaults/[vaultId]/accounts": "account_mutation",
  "POST /api/v1/shared-vaults/[vaultId]/audit-events": "audit_event",
  "POST /api/v1/shared-vaults/[vaultId]/leave": "membership_mutation",
  "DELETE /api/v1/shared-vaults/[vaultId]/lifecycle": "destructive_mutation",
  "POST /api/v1/shared-vaults/[vaultId]/lifecycle": "destructive_mutation",
  "PATCH /api/v1/shared-vaults/[vaultId]/member-permissions": "membership_mutation",
  "PATCH /api/v1/shared-vaults/[vaultId]/members/[userId]": "membership_mutation",
  "DELETE /api/v1/shared-vaults/[vaultId]/members/[userId]": "membership_mutation",
  "PATCH /api/v1/shared-vaults/[vaultId]/rotation": "key_material_mutation",
  "PATCH /api/v1/shared-vaults/[vaultId]": "vault_mutation",
  "DELETE /api/v1/shared-vaults/[vaultId]/share-links/[invitationId]": "membership_mutation",
  "POST /api/v1/shared-vaults/[vaultId]/share-links": "membership_mutation",
  "POST /api/v1/shared-vaults": "vault_mutation",
  "POST /api/v1/user-crypto-profile/rewrap": "key_material_mutation",
  "PUT /api/v1/user-encryption-identity": "key_material_mutation",
  "POST /api/v1/vault-imports": "archive_import",
  "POST /api/v1/vaults/[vaultId]/archive-exports": "archive_export",
  "POST /api/v1/vaults/[vaultId]/audit-events": "account_mutation",
  "POST /api/v1/vaults/[vaultId]/accounts": "account_mutation",
  "PATCH /api/v1/vaults/[vaultId]/accounts": "account_mutation",
  "DELETE /api/v1/vaults/[vaultId]/accounts": "account_mutation",
  "PUT /api/v1/vaults/[vaultId]/accounts": "account_mutation",
} as const satisfies Record<string, ApplicationRateLimitPolicyId>;

export const STATE_CHANGING_ROUTE_RATE_LIMIT_EXCLUSIONS = {
  "GET /api/v1/internal/retention-purge":
    "Machine-authenticated retention cron uses Vercel Cron GET; no application user exists.",
  "POST /api/v1/auth/magic-link/request":
    "Passwordless link requests are governed by the anonymous email and IP rate-limit windows.",
  "POST /api/v1/auth/magic-link/redeem":
    "One-time link redemption has no authenticated Application User and is governed by challenge consumption.",
  "POST /auth/logout": "Idempotent session termination must remain available without an application user.",
  "POST /api/v1/auth/session/refresh":
    "Native refresh-token rotation and browser session keepalive have no authenticated Application User and are governed by the session family or active browser assertion.",
  "POST /api/v1/auth/pwa/session":
    "PWA session handoff rotates a transient refresh credential and has no authenticated Application User before cookie issuance.",
  "POST /api/v1/auth/session/revoke":
    "Idempotent native session termination is authenticated by the bearer session credential.",
} as const;
