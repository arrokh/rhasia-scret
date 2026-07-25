import { NextResponse } from "next/server";
import { loadApplicationUser } from "@/modules/identity/application/load-application-user";
import { PrismaApplicationUserRepository } from "@/modules/identity/infrastructure/prisma-application-user-repository";
import { SupabaseSessionVerifier } from "@/modules/identity/infrastructure/supabase-session-verifier";
import { PrismaSharedVaultRecoveryRepository } from "@/modules/vault-management/infrastructure/prisma-shared-vault-recovery-repository";

export async function DELETE(_request: Request, { params }: { params: Promise<{ vaultId: string }> }) {
  return changeLifecycle(params, "delete");
}

export async function POST(_request: Request, { params }: { params: Promise<{ vaultId: string }> }) {
  return changeLifecycle(params, "restore");
}

async function changeLifecycle(params: Promise<{ vaultId: string }>, action: "delete" | "restore") {
  const user = await loadApplicationUser(new SupabaseSessionVerifier(), new PrismaApplicationUserRepository());
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!user.canAccessApplication()) return NextResponse.json({ error: "inactive_user" }, { status: 403 });
  const { vaultId } = await params;
  const repository = new PrismaSharedVaultRecoveryRepository();
  const changed = action === "delete" ? await repository.delete(user.id, vaultId) : await repository.restore(user.id, vaultId);
  return changed ? new NextResponse(null, { status: 204 }) : NextResponse.json({ error: "shared_vault_unavailable" }, { status: 404 });
}
