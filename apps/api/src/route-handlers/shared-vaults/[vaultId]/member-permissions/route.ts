import { getApiRequestContext } from "@api/http/api-context";
import { ApiResponse } from "@api/http/api-request";
import { safeParseJsonBody } from "@api/http/validation";
import { z } from "zod";
import {
  loadSharedVaultMemberPermissionDefaults,
  updateSharedVaultMemberPermissionDefaults,
} from "@api/modules/vault-membership/server";
import {
  authenticateApplicationMutation,
  authenticateApplicationReader,
} from "@api/shared/infrastructure/authenticated-application-request";

const defaultsSchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    canAddAccounts: z.boolean(),
    canEditAccounts: z.boolean(),
    canDeleteAccounts: z.boolean(),
  })
  .strict();

export async function GET(request: Request, { params }: { params: Promise<{ vaultId: string }> }) {
  const user = await authenticateApplicationReader(request, "fresh-provider-user");
  if (user instanceof ApiResponse) return user;
  const { vaultId } = await params;
  const defaults = await loadSharedVaultMemberPermissionDefaults(
    user.id,
    vaultId,
    getApiRequestContext(request).applicationRuntime.sharedVaultAccountPermissions(),
  );
  if (!defaults) return ApiResponse.json({ error: "owner_access_required" }, { status: 404 });
  return ApiResponse.json({
    vaultDefaultAccountPermissions: defaults.permissions,
    vaultDefaultAccountPermissionsRevision: defaults.revision,
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ vaultId: string }> }) {
  const user = await authenticateApplicationMutation(request, "membership_mutation", "fresh-provider-user");
  if (user instanceof ApiResponse) return user;
  const parsed = await safeParseJsonBody(request, defaultsSchema);
  if (!parsed.success) return ApiResponse.json({ error: "invalid_member_permissions" }, { status: 400 });
  const { vaultId } = await params;
  const result = await updateSharedVaultMemberPermissionDefaults(
    user.id,
    vaultId,
    parsed.data.expectedRevision,
    {
      canAddAccounts: parsed.data.canAddAccounts,
      canEditAccounts: parsed.data.canEditAccounts,
      canDeleteAccounts: parsed.data.canDeleteAccounts,
    },
    getApiRequestContext(request).applicationRuntime.sharedVaultAccountPermissions(),
  );
  if (result.status === "UNAVAILABLE") return ApiResponse.json({ error: "owner_access_required" }, { status: 404 });
  if (result.status === "STALE") return ApiResponse.json({ error: "stale_permissions_revision" }, { status: 409 });
  return ApiResponse.json({
    vaultDefaultAccountPermissions: result.value.permissions,
    vaultDefaultAccountPermissionsRevision: result.value.revision,
  });
}
