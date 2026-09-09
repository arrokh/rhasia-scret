import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createSharedVaultAccountPermissionRepository,
  loadSharedVaultMemberPermissionDefaults,
  updateSharedVaultMemberPermissionDefaults,
} from "@/modules/vault-membership/server";
import {
  authenticateApplicationMutation,
  authenticateApplicationReader,
} from "@/shared/infrastructure/authenticated-application-request";

const defaultsSchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    canAddAccounts: z.boolean(),
    canEditAccounts: z.boolean(),
    canDeleteAccounts: z.boolean(),
  })
  .strict();

export async function GET(_request: Request, { params }: { params: Promise<{ vaultId: string }> }) {
  const user = await authenticateApplicationReader("fresh-provider-user");
  if (user instanceof NextResponse) return user;
  const { vaultId } = await params;
  const defaults = await loadSharedVaultMemberPermissionDefaults(
    user.id,
    vaultId,
    createSharedVaultAccountPermissionRepository(),
  );
  if (!defaults) return NextResponse.json({ error: "owner_access_required" }, { status: 404 });
  return NextResponse.json({
    vaultDefaultAccountPermissions: defaults.permissions,
    vaultDefaultAccountPermissionsRevision: defaults.revision,
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ vaultId: string }> }) {
  const user = await authenticateApplicationMutation("membership_mutation", "fresh-provider-user");
  if (user instanceof NextResponse) return user;
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
      canDeleteAccounts: parsed.data.canDeleteAccounts,
    },
    createSharedVaultAccountPermissionRepository(),
  );
  if (result.status === "UNAVAILABLE") return NextResponse.json({ error: "owner_access_required" }, { status: 404 });
  if (result.status === "STALE") return NextResponse.json({ error: "stale_permissions_revision" }, { status: 409 });
  return NextResponse.json({
    vaultDefaultAccountPermissions: result.value.permissions,
    vaultDefaultAccountPermissionsRevision: result.value.revision,
  });
}
