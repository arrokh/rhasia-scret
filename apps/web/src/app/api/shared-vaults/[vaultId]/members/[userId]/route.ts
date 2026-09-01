import { NextResponse } from "next/server";
import { z } from "zod";
import { createMembershipLifecycleRepository, createSharedVaultAccountPermissionRepository, MembershipUnavailableError, revokeVaultMembership, updateSharedVaultMemberPermissionOverrides } from "@/modules/vault-membership/server";
import { authenticateApplicationMutation } from "@/shared/infrastructure/authenticated-application-request";

const overridesSchema = z.object({
  expectedRevision: z.number().int().positive(),
  canAddAccounts: z.boolean().nullable(),
  canEditAccounts: z.boolean().nullable(),
  canDeleteAccounts: z.boolean().nullable()
}).strict();

export async function PATCH(request: Request, { params }: { params: Promise<{ vaultId: string; userId: string }> }) {
  const user = await authenticateApplicationMutation("membership_mutation", "fresh-provider-user");
  if (user instanceof NextResponse) return user;
  const parsed = overridesSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "invalid_member_permissions" }, { status: 400 });
  const { vaultId, userId } = await params;
  const result = await updateSharedVaultMemberPermissionOverrides(
    user.id,
    vaultId,
    userId,
    parsed.data.expectedRevision,
    {
      canAddAccounts: parsed.data.canAddAccounts,
      canEditAccounts: parsed.data.canEditAccounts,
      canDeleteAccounts: parsed.data.canDeleteAccounts
    },
    createSharedVaultAccountPermissionRepository()
  );
  if (result.status === "UNAVAILABLE") return NextResponse.json({ error: "member_unavailable" }, { status: 404 });
  if (result.status === "STALE") return NextResponse.json({ error: "stale_permissions_revision" }, { status: 409 });
  return NextResponse.json({
    permissionOverrides: result.value.overrides,
    effectiveAccountPermissions: result.value.effective,
    permissionsRevision: result.value.revision
  });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ vaultId: string; userId: string }> }) {
  const user = await authenticateApplicationMutation("membership_mutation", "fresh-provider-user");
  if (user instanceof NextResponse) return user;
  try {
    const { vaultId, userId } = await params;
    await revokeVaultMembership(user.id, vaultId, userId, createMembershipLifecycleRepository());
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof MembershipUnavailableError) return NextResponse.json({ error: "member_unavailable" }, { status: 404 });
    throw error;
  }
}
