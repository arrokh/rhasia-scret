import { getApiRequestContext } from "@api/http/api-context";
import { ApiResponse, type ApiRequest } from "@api/http/api-request";
import { ensurePersonalVault, type PersonalVaultRepository } from "@api/modules/vault-management/server";
import { authenticateApplicationReader } from "@api/shared/infrastructure/authenticated-application-request";

type Dependencies = {
  authenticate: typeof authenticateApplicationReader;
  personalVaults: PersonalVaultRepository;
};

export function createGetPersonalVaultHandler({ authenticate, personalVaults }: Dependencies) {
  return async function GET(request: ApiRequest) {
    const user = await authenticate(request, "fresh-provider-user");
    if (user instanceof ApiResponse) return user;
    const vault = await ensurePersonalVault(user.id, personalVaults);
    return ApiResponse.json({ id: vault.id, lifecycle: vault.lifecycle });
  };
}

export async function GET(request: ApiRequest) {
  return createGetPersonalVaultHandler({
    authenticate: authenticateApplicationReader,
    personalVaults: getApiRequestContext(request).applicationRuntime.personalVaults(),
  })(request);
}
