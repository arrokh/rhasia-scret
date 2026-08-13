import type { SharedVaultAccountPermissions } from "@rhasia-scret/client-vault-core";
import type { AuthenticatedTransport } from "@rhasia-scret/client-vault-core";

export type MobileVaultPermissionDefaults = { permissions: SharedVaultAccountPermissions; revision: number };

export async function loadMobileVaultPermissionDefaults(vaultId: string, transport: AuthenticatedTransport): Promise<MobileVaultPermissionDefaults> {
  const response = await transport.request({ url: `/api/shared-vaults/${encodeURIComponent(vaultId)}/member-permissions`, method: "GET", cache: "no-store" });
  if (!response.ok) throw new Error("Shared Vault permission defaults are unavailable.");
  return parse(await response.json<unknown>());
}

export async function updateMobileVaultPermissionDefaults(vaultId: string, current: MobileVaultPermissionDefaults, transport: AuthenticatedTransport): Promise<MobileVaultPermissionDefaults> {
  const response = await transport.request({
    url: `/api/shared-vaults/${encodeURIComponent(vaultId)}/member-permissions`,
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ expectedRevision: current.revision, ...current.permissions }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Shared Vault permission defaults could not be updated.");
  return parse(await response.json<unknown>());
}

function parse(value: unknown): MobileVaultPermissionDefaults {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const record = value as Record<string, unknown>;
  const permissions = record.vaultDefaultAccountPermissions;
  if (!permissions || typeof permissions !== "object" || Array.isArray(permissions)) invalid();
  const values = permissions as Record<string, unknown>;
  if (typeof values.canAddAccounts !== "boolean" || typeof values.canEditAccounts !== "boolean" || typeof values.canDeleteAccounts !== "boolean" || typeof record.vaultDefaultAccountPermissionsRevision !== "number" || !Number.isSafeInteger(record.vaultDefaultAccountPermissionsRevision) || record.vaultDefaultAccountPermissionsRevision < 1) invalid();
  return { permissions: { canAddAccounts: values.canAddAccounts, canEditAccounts: values.canEditAccounts, canDeleteAccounts: values.canDeleteAccounts }, revision: record.vaultDefaultAccountPermissionsRevision };
}

function invalid(): never { throw new Error("Shared Vault permission response is invalid."); }
