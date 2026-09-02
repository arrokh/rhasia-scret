import { NextResponse } from "next/server";
import { createSharedVaultRecoveryRepository } from "@/modules/vault-management/server";
import { authenticateApplicationMutation } from "@/shared/infrastructure/authenticated-application-request";

export async function DELETE(_request: Request, { params }: { params: Promise<{ vaultId: string }> }) {
  return changeLifecycle(params, "delete");
}

export async function POST(_request: Request, { params }: { params: Promise<{ vaultId: string }> }) {
  return changeLifecycle(params, "restore");
}

async function changeLifecycle(params: Promise<{ vaultId: string }>, action: "delete" | "restore") {
  const user = await authenticateApplicationMutation("destructive_mutation", "fresh-provider-user");
  if (user instanceof NextResponse) return user;
  const { vaultId } = await params;
  const repository = createSharedVaultRecoveryRepository();
  const changed = action === "delete" ? await repository.delete(user.id, vaultId) : await repository.restore(user.id, vaultId);
  if (!changed) return NextResponse.json({ error: "shared_vault_unavailable" }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
