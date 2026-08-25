import { NextResponse } from "next/server";
import { createApplicationUserRepository, createSessionVerifier, loadApplicationUser } from "@/modules/identity/server";
import { rateLimitApplicationUser } from "@/modules/rate-limiting";
import { createSharedVaultRecoveryRepository } from "@/modules/vault-management/server";

export async function DELETE(_request: Request, { params }: { params: Promise<{ vaultId: string }> }) {
  return changeLifecycle(params, "delete");
}

export async function POST(_request: Request, { params }: { params: Promise<{ vaultId: string }> }) {
  return changeLifecycle(params, "restore");
}

async function changeLifecycle(params: Promise<{ vaultId: string }>, action: "delete" | "restore") {
  const user = await loadApplicationUser(createSessionVerifier(), createApplicationUserRepository());
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!user.canAccessApplication()) return NextResponse.json({ error: "inactive_user" }, { status: 403 });
  const rateLimited = await rateLimitApplicationUser("destructive_mutation", user.id);
  if (rateLimited) return rateLimited;
  const { vaultId } = await params;
  const repository = createSharedVaultRecoveryRepository();
  const changed = action === "delete" ? await repository.delete(user.id, vaultId) : await repository.restore(user.id, vaultId);
  if (!changed) return NextResponse.json({ error: "shared_vault_unavailable" }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
