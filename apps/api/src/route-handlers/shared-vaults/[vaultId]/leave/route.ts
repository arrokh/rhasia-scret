import { getApiRequestContext } from "@api/http/api-context";
import { ApiResponse } from "@api/http/api-request";
import {
  createMembershipLifecycleRepository,
  leaveVaultMembership,
  MembershipUnavailableError,
} from "@api/modules/vault-membership/server";
import { authenticateApplicationMutation } from "@api/shared/infrastructure/authenticated-application-request";

export async function POST(request: Request, { params }: { params: Promise<{ vaultId: string }> }) {
  const user = await authenticateApplicationMutation(request, "membership_mutation", "fresh-provider-user");
  if (user instanceof ApiResponse) return user;
  try {
    const { vaultId } = await params;
    await leaveVaultMembership(
      user.id,
      vaultId,
      createMembershipLifecycleRepository(getApiRequestContext(request).database),
    );
    return new ApiResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof MembershipUnavailableError)
      return ApiResponse.json({ error: "viewer_membership_unavailable" }, { status: 404 });
    throw error;
  }
}
