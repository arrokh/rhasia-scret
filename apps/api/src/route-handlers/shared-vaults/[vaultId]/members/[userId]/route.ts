import { getApiRequestContext } from "@api/http/api-context";
import { ApiResponse } from "@api/http/api-request";
import { safeParseJsonBody } from "@api/http/validation";
import { z } from "zod";
import {
  MembershipUnavailableError,
  revokeVaultMembership,
  updateSharedVaultMemberPermissionOverrides,
} from "@api/modules/vault-membership/server";
import { authenticateApplicationMutation } from "@api/shared/infrastructure/authenticated-application-request";

const overridesSchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    canAddAccounts: z.boolean().nullable(),
    canEditAccounts: z.boolean().nullable(),
    canDeleteAccounts: z.boolean().nullable(),
  })
  .strict();

export async function PATCH(request: Request, { params }: { params: Promise<{ vaultId: string; userId: string }> }) {
  const user = await authenticateApplicationMutation(request, "membership_mutation", "fresh-provider-user");
  if (user instanceof ApiResponse) return user;
  const parsed = await safeParseJsonBody(request, overridesSchema);
  if (!parsed.success) return ApiResponse.json({ error: "invalid_member_permissions" }, { status: 400 });
  const { vaultId, userId } = await params;
  const result = await updateSharedVaultMemberPermissionOverrides(
    user.id,
    vaultId,
    userId,
    parsed.data.expectedRevision,
    {
      canAddAccounts: parsed.data.canAddAccounts,
      canEditAccounts: parsed.data.canEditAccounts,
      canDeleteAccounts: parsed.data.canDeleteAccounts,
    },
    getApiRequestContext(request).applicationRuntime.sharedVaultAccountPermissions(),
  );
  if (result.status === "UNAVAILABLE") return ApiResponse.json({ error: "member_unavailable" }, { status: 404 });
  if (result.status === "STALE") return ApiResponse.json({ error: "stale_permissions_revision" }, { status: 409 });
  return ApiResponse.json({
    permissionOverrides: result.value.overrides,
    effectiveAccountPermissions: result.value.effective,
    permissionsRevision: result.value.revision,
  });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ vaultId: string; userId: string }> }) {
  const user = await authenticateApplicationMutation(request, "membership_mutation", "fresh-provider-user");
  if (user instanceof ApiResponse) return user;
  try {
    const { vaultId, userId } = await params;
    await revokeVaultMembership(
      user.id,
      vaultId,
      userId,
      getApiRequestContext(request).applicationRuntime.membershipLifecycle(),
    );
    return new ApiResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof MembershipUnavailableError)
      return ApiResponse.json({ error: "member_unavailable" }, { status: 404 });
    throw error;
  }
}
