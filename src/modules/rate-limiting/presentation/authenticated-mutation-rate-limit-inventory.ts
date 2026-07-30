import type { ApplicationRateLimitPolicyId } from "../domain/application-rate-limit-policy";

export const AUTHENTICATED_MUTATION_RATE_LIMIT_POLICIES = {
  "POST /api/passkey-recovery/authentication/options": "recovery_authentication",
  "POST /api/passkey-recovery/authentication/verify": "recovery_authentication",
  "POST /api/passkey-recovery/registration/options": "recovery_mutation",
  "POST /api/passkey-recovery/registration/verify": "recovery_mutation",
  "DELETE /api/passkey-recovery": "recovery_mutation",
  "POST /api/personal-vault/destructive-reset": "destructive_mutation",
  "POST /api/personal-vault/initialize": "key_material_mutation",
  "POST /api/secure-share-links": "membership_mutation",
  "POST /api/shared-vaults/[vaultId]/accounts": "account_mutation",
  "PATCH /api/shared-vaults/[vaultId]/accounts": "account_mutation",
  "DELETE /api/shared-vaults/[vaultId]/accounts": "account_mutation",
  "PUT /api/shared-vaults/[vaultId]/accounts": "account_mutation",
  "POST /api/shared-vaults/[vaultId]/audit-events": "audit_event",
  "POST /api/shared-vaults/[vaultId]/leave": "membership_mutation",
  "DELETE /api/shared-vaults/[vaultId]/lifecycle": "destructive_mutation",
  "POST /api/shared-vaults/[vaultId]/lifecycle": "destructive_mutation",
  "PATCH /api/shared-vaults/[vaultId]/member-permissions": "membership_mutation",
  "PATCH /api/shared-vaults/[vaultId]/members/[userId]": "membership_mutation",
  "DELETE /api/shared-vaults/[vaultId]/members/[userId]": "membership_mutation",
  "PATCH /api/shared-vaults/[vaultId]/rotation": "key_material_mutation",
  "PATCH /api/shared-vaults/[vaultId]": "vault_mutation",
  "DELETE /api/shared-vaults/[vaultId]/share-links/[invitationId]": "membership_mutation",
  "POST /api/shared-vaults/[vaultId]/share-links": "membership_mutation",
  "POST /api/shared-vaults": "vault_mutation",
  "POST /api/user-crypto-profile/rewrap": "key_material_mutation",
  "PUT /api/user-encryption-identity": "key_material_mutation",
  "POST /api/vault-imports": "archive_import",
  "POST /api/vaults/[vaultId]/archive-exports": "archive_export",
  "POST /api/vaults/[vaultId]/audit-events": "account_mutation",
  "POST /api/vaults/[vaultId]/accounts": "account_mutation",
  "PATCH /api/vaults/[vaultId]/accounts": "account_mutation",
  "DELETE /api/vaults/[vaultId]/accounts": "account_mutation",
  "PUT /api/vaults/[vaultId]/accounts": "account_mutation"
} as const satisfies Record<string, ApplicationRateLimitPolicyId>;

export const STATE_CHANGING_ROUTE_RATE_LIMIT_EXCLUSIONS = {
  "GET /api/internal/retention-purge": "Machine-authenticated retention cron uses Vercel Cron GET; no application user exists.",
  "GET /auth/confirm": "Supabase Auth callback exchange has no authenticated Application User and remains governed by Supabase.",
  "POST /auth/logout": "Idempotent session termination must remain available without an application user."
} as const;
