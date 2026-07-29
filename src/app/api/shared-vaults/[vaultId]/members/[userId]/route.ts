import { NextResponse } from "next/server";
import { z } from "zod";
import { loadApplicationUser } from "@/modules/identity/application/load-application-user";
import { createApplicationUserRepository, createSessionVerifier } from "@/modules/identity/server";
import { rateLimitApplicationUser } from "@/modules/rate-limiting";
import { MembershipUnavailableError, revokeVaultMembership } from "@/modules/vault-membership/application/manage-membership-lifecycle";
import { PrismaMembershipLifecycleRepository } from "@/modules/vault-membership/infrastructure/prisma-membership-lifecycle-repository";
import { updateSharedVaultMemberPermissionOverrides } from "@/modules/vault-membership/application/manage-shared-vault-account-permissions";
import { PrismaSharedVaultAccountPermissionRepository } from "@/modules/vault-membership/infrastructure/prisma-shared-vault-account-permission-repository";

const overridesSchema = z.object({
  expectedRevision: z.number().int().positive(),
  canAddAccounts: z.boolean().nullable(),
  canEditAccounts: z.boolean().nullable(),
  canDeleteAccounts: z.boolean().nullable()
}).strict();

export async function PATCH(request: Request, { params }: { params: Promise<{ vaultId: string; userId: string }> }) {
  const user = await loadApplicationUser(createSessionVerifier(), createApplicationUserRepository());
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!user.canAccessApplication()) return NextResponse.json({ error: "inactive_user" }, { status: 403 });
  const rateLimited = await rateLimitApplicationUser("membership_mutation", user.id);
  if (rateLimited) return rateLimited;
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
    new PrismaSharedVaultAccountPermissionRepository()
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
  const user = await loadApplicationUser(createSessionVerifier(), createApplicationUserRepository());
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!user.canAccessApplication()) return NextResponse.json({ error: "inactive_user" }, { status: 403 });
  const rateLimited = await rateLimitApplicationUser("membership_mutation", user.id);
  if (rateLimited) return rateLimited;
  try {
    const { vaultId, userId } = await params;
    await revokeVaultMembership(user.id, vaultId, userId, new PrismaMembershipLifecycleRepository());
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof MembershipUnavailableError) return NextResponse.json({ error: "member_unavailable" }, { status: 404 });
    throw error;
  }
}
