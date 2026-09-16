import { ApiResponse } from "@api/http/api-request";
import { getApiRequestContext } from "@api/http/api-context";
import { createSharedVaultRecoveryRepository } from "@api/modules/vault-management/server";
import { authenticateApplicationMutation } from "@api/shared/infrastructure/authenticated-application-request";

export async function DELETE(request: Request, { params }: { params: Promise<{ vaultId: string }> }) {
  return changeLifecycle(request, params, "delete");
}

export async function POST(request: Request, { params }: { params: Promise<{ vaultId: string }> }) {
  return changeLifecycle(request, params, "restore");
}

async function changeLifecycle(request: Request, params: Promise<{ vaultId: string }>, action: "delete" | "restore") {
  const user = await authenticateApplicationMutation(request, "destructive_mutation", "fresh-provider-user");
  if (user instanceof ApiResponse) return user;
  const { vaultId } = await params;
  const repository = createSharedVaultRecoveryRepository(getApiRequestContext(request).database);
  const changed =
    action === "delete" ? await repository.delete(user.id, vaultId) : await repository.restore(user.id, vaultId);
  if (!changed) return ApiResponse.json({ error: "shared_vault_unavailable" }, { status: 404 });
  return new ApiResponse(null, { status: 204 });
}
