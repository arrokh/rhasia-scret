import { getApiRequestContext } from "@api/http/api-context";
import { ApiResponse, type ApiRequest } from "@api/http/api-request";
import { z } from "zod";
import {
  ActiveOwnedSharedVaultsPreventResetError,
  createDestructivePersonalVaultResetRepository,
  InvalidDestructiveResetConfirmationError,
  PasskeyRecoveryAlreadyEnrolledError,
  destructivelyResetPersonalVault,
  type DestructivePersonalVaultResetRepository,
} from "@api/modules/vault-management/server";
import {
  authenticateApplicationMutation,
  authenticateApplicationReader,
} from "@api/shared/infrastructure/authenticated-application-request";

const bodySchema = z.object({ confirmation: z.string() });

type Dependencies = {
  authenticate: typeof authenticateApplicationMutation;
  resets: DestructivePersonalVaultResetRepository;
};

export function createDestructivePersonalVaultResetHandler({ authenticate, resets }: Dependencies) {
  return async function POST(request: ApiRequest) {
    const user = await authenticate(request, "destructive_mutation", "fresh-provider-user");
    if (user instanceof ApiResponse) return user;
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return ApiResponse.json({ error: "invalid_confirmation" }, { status: 400 });

    try {
      await destructivelyResetPersonalVault(user.id, parsed.data.confirmation, resets);
      return new ApiResponse(null, { status: 204 });
    } catch (error) {
      if (error instanceof InvalidDestructiveResetConfirmationError) {
        return ApiResponse.json({ error: "invalid_confirmation" }, { status: 400 });
      }
      if (error instanceof PasskeyRecoveryAlreadyEnrolledError) {
        return ApiResponse.json({ error: "passkey_recovery_available" }, { status: 409 });
      }
      if (error instanceof ActiveOwnedSharedVaultsPreventResetError) {
        return ApiResponse.json({ error: "owned_shared_vaults_exist", count: error.count }, { status: 409 });
      }
      return ApiResponse.json({ error: "destructive_reset_failed" }, { status: 500 });
    }
  };
}

export async function GET(request: ApiRequest) {
  const user = await authenticateApplicationReader(request, "fresh-provider-user");
  if (user instanceof ApiResponse) return user;
  const eligibility = await createDestructivePersonalVaultResetRepository(
    getApiRequestContext(request).database,
  ).getEligibility(user.id);
  return ApiResponse.json(eligibility, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: ApiRequest) {
  return createDestructivePersonalVaultResetHandler({
    authenticate: authenticateApplicationMutation,
    resets: createDestructivePersonalVaultResetRepository(getApiRequestContext(request).database),
  })(request);
}
