import { NextResponse } from "next/server";
import { z } from "zod";
import { loadApplicationUser } from "@/modules/identity/application/load-application-user";
import { PrismaApplicationUserRepository } from "@/modules/identity/infrastructure/prisma-application-user-repository";
import { SupabaseSessionVerifier } from "@/modules/identity/infrastructure/supabase-session-verifier";
import { rateLimitApplicationUser } from "@/modules/rate-limiting";
import { loadSharedVaultMemberPermissionDefaults, updateSharedVaultMemberPermissionDefaults } from "@/modules/vault-membership/application/manage-shared-vault-account-permissions";
import { PrismaSharedVaultAccountPermissionRepository } from "@/modules/vault-membership/infrastructure/prisma-shared-vault-account-permission-repository";

const defaultsSchema = z.object({
  expectedRevision: z.number().int().positive(),
  canAddAccounts: z.boolean(),
  canEditAccounts: z.boolean(),
  canDeleteAccounts: z.boolean()
}).strict();

export async function GET(_request: Request, { params }: { params: Promise<{ vaultId: string }> }) {
  const user = await loadApplicationUser(new SupabaseSessionVerifier(), new PrismaApplicationUserRepository());
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!user.canAccessApplication()) return NextResponse.json({ error: "inactive_user" }, { status: 403 });
  const { vaultId } = await params;
  const defaults = await loadSharedVaultMemberPermissionDefaults(user.id, vaultId, new PrismaSharedVaultAccountPermissionRepository());
  if (!defaults) return NextResponse.json({ error: "owner_access_required" }, { status: 404 });
  return NextResponse.json({
    vaultDefaultAccountPermissions: defaults.permissions,
    vaultDefaultAccountPermissionsRevision: defaults.revision
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ vaultId: string }> }) {
  const user = await loadApplicationUser(new SupabaseSessionVerifier(), new PrismaApplicationUserRepository());
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!user.canAccessApplication()) return NextResponse.json({ error: "inactive_user" }, { status: 403 });
  const rateLimited = await rateLimitApplicationUser("membership_mutation", user.id);
  if (rateLimited) return rateLimited;
  const parsed = defaultsSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "invalid_member_permissions" }, { status: 400 });
  const { vaultId } = await params;
  const result = await updateSharedVaultMemberPermissionDefaults(
    user.id,
    vaultId,
    parsed.data.expectedRevision,
    {
      canAddAccounts: parsed.data.canAddAccounts,
      canEditAccounts: parsed.data.canEditAccounts,
      canDeleteAccounts: parsed.data.canDeleteAccounts
    },
    new PrismaSharedVaultAccountPermissionRepository()
  );
  if (result.status === "UNAVAILABLE") return NextResponse.json({ error: "owner_access_required" }, { status: 404 });
  if (result.status === "STALE") return NextResponse.json({ error: "stale_permissions_revision" }, { status: 409 });
  return NextResponse.json({
    vaultDefaultAccountPermissions: result.value.permissions,
    vaultDefaultAccountPermissionsRevision: result.value.revision
  });
}
