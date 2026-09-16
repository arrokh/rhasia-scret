import { getApiRequestContext } from "@api/http/api-context";
import { ApiResponse } from "@api/http/api-request";
import { cancelPendingVaultInvitation, createVaultParticipantRepository } from "@api/modules/vault-membership/server";
import { authenticateApplicationMutation } from "@api/shared/infrastructure/authenticated-application-request";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ vaultId: string; invitationId: string }> },
) {
  const user = await authenticateApplicationMutation(request, "membership_mutation", "fresh-provider-user");
  if (user instanceof ApiResponse) return user;
  const { vaultId, invitationId } = await params;
  const cancelled = await cancelPendingVaultInvitation(
    user.id,
    vaultId,
    invitationId,
    createVaultParticipantRepository(getApiRequestContext(request).database),
  );
  if (!cancelled) return ApiResponse.json({ error: "invitation_unavailable" }, { status: 404 });
  return new ApiResponse(null, { status: 204 });
}
