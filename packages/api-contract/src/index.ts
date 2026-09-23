import { z } from "zod";

export * from "./paths";

/** Errors are locale-independent transport values; presentation owns translation. */
export const apiErrorSchema = z
  .object({
    error: z.string().min(1),
  })
  .passthrough();

export type ApiError = z.infer<typeof apiErrorSchema>;

export const healthResponseSchema = z.object({ status: z.literal("ok") });
export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const timeResponseSchema = z.object({ now: z.iso.datetime() });
export type TimeResponse = z.infer<typeof timeResponseSchema>;

export type ApiRouteMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
export type ApiRouteManifestEntry = Readonly<{ method: ApiRouteMethod; path: string }>;

/** The client-safe, version-independent operation manifest for the canonical API. */
export const API_ROUTE_MANIFEST = [
  ["POST", "/auth/magic-link/request"],
  ["POST", "/auth/magic-link/redeem"],
  ["POST", "/auth/pwa/session"],
  ["POST", "/auth/session/refresh"],
  ["POST", "/auth/session/revoke"],
  ["GET", "/health"],
  ["GET", "/time"],
  ["GET", "/internal/retention-purge"],
  ["GET", "/me"],
  ["DELETE", "/me"],
  ["GET", "/me/deletion/preview"],
  ["POST", "/me/deletion/oidc/start"],
  ["POST", "/me/deletion/oidc/complete"],
  ["POST", "/me/deletion/otp/request"],
  ["POST", "/me/deletion/otp/verify"],
  ["POST", "/passkey-recovery/registration/options"],
  ["POST", "/passkey-recovery/registration/verify"],
  ["POST", "/passkey-recovery/authentication/options"],
  ["POST", "/passkey-recovery/authentication/verify"],
  ["GET", "/passkey-recovery/status"],
  ["DELETE", "/passkey-recovery"],
  ["GET", "/personal-vault"],
  ["POST", "/personal-vault/initialize"],
  ["GET", "/personal-vault/destructive-reset"],
  ["POST", "/personal-vault/destructive-reset"],
  ["GET", "/user-crypto-profile"],
  ["POST", "/user-crypto-profile/rewrap"],
  ["PUT", "/user-encryption-identity"],
  ["POST", "/vault-imports"],
  ["GET", "/shared-vaults"],
  ["POST", "/shared-vaults"],
  ["GET", "/shared-vaults/:vaultId"],
  ["PATCH", "/shared-vaults/:vaultId"],
  ["POST", "/shared-vaults/:vaultId/accounts"],
  ["PATCH", "/shared-vaults/:vaultId/accounts"],
  ["DELETE", "/shared-vaults/:vaultId/accounts"],
  ["PUT", "/shared-vaults/:vaultId/accounts"],
  ["GET", "/shared-vaults/:vaultId/audit-events"],
  ["POST", "/shared-vaults/:vaultId/audit-events"],
  ["POST", "/shared-vaults/:vaultId/leave"],
  ["DELETE", "/shared-vaults/:vaultId/lifecycle"],
  ["POST", "/shared-vaults/:vaultId/lifecycle"],
  ["GET", "/shared-vaults/:vaultId/member-permissions"],
  ["PATCH", "/shared-vaults/:vaultId/member-permissions"],
  ["PATCH", "/shared-vaults/:vaultId/members/:userId"],
  ["DELETE", "/shared-vaults/:vaultId/members/:userId"],
  ["GET", "/shared-vaults/:vaultId/participants"],
  ["PATCH", "/shared-vaults/:vaultId/rotation"],
  ["POST", "/shared-vaults/:vaultId/share-links"],
  ["DELETE", "/shared-vaults/:vaultId/share-links/:invitationId"],
  ["GET", "/secure-share-links"],
  ["POST", "/secure-share-links"],
  ["GET", "/vaults/:vaultId/accounts"],
  ["POST", "/vaults/:vaultId/accounts"],
  ["PATCH", "/vaults/:vaultId/accounts"],
  ["DELETE", "/vaults/:vaultId/accounts"],
  ["PUT", "/vaults/:vaultId/accounts"],
  ["POST", "/vaults/:vaultId/archive-exports"],
  ["GET", "/vaults/:vaultId/audit-events"],
  ["POST", "/vaults/:vaultId/audit-events"],
  ["GET", "/sync/offline-bundle"],
  ["GET", "/sync/workspace-bundle"],
] as const satisfies readonly (readonly [ApiRouteMethod, string])[];
