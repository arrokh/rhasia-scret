import { getApiRequestContext } from "@api/http/api-context";
import { ApiResponse, type ApiRequest } from "@api/http/api-request";
import { authenticateApplicationMutation } from "@api/shared/infrastructure/authenticated-application-request";
import { authBackend } from "@api/modules/identity/server";
import {
  isBrowserAccountDeletionRequest,
  noStoreHeaders,
  setDeletionOidcChallengeCookie,
  type AccountDeletionRepository,
} from "@api/modules/account-deletion/server";

type StartOidcDeletionReauthenticationDependencies = Readonly<{
  authenticate: typeof authenticateApplicationMutation;
  backend: (request: ApiRequest) => ReturnType<typeof authBackend>;
  repository: Pick<AccountDeletionRepository, "createOidcReauthenticationChallenge">;
}>;

export function createStartOidcDeletionReauthenticationHandler({
  authenticate,
  backend,
  repository,
}: StartOidcDeletionReauthenticationDependencies) {
  return async function POST(request: ApiRequest): Promise<ApiResponse> {
    if (!isBrowserAccountDeletionRequest(request))
      return ApiResponse.json({ error: "same_origin_required" }, { status: 403, headers: noStoreHeaders() });
    if (backend(request) !== "oidc")
      return ApiResponse.json(
        { error: "oidc_reauthentication_unavailable" },
        { status: 409, headers: noStoreHeaders() },
      );
    const user = await authenticate(request, "account_deletion_authentication", "fresh-provider-user");
    if (user instanceof ApiResponse) return user;
    try {
      const challengeId = await repository.createOidcReauthenticationChallenge(user.id, new Date());
      const response = new ApiResponse(null, { status: 204, headers: noStoreHeaders() });
      setDeletionOidcChallengeCookie(response.cookies, challengeId);
      return response;
    } catch {
      return ApiResponse.json(
        { error: "oidc_reauthentication_unavailable" },
        { status: 503, headers: noStoreHeaders() },
      );
    }
  };
}

export async function POST(request: ApiRequest) {
  const context = getApiRequestContext(request);
  return createStartOidcDeletionReauthenticationHandler({
    authenticate: authenticateApplicationMutation,
    backend: () => authBackend(context.bindings),
    repository: context.applicationRuntime.accountDeletion(),
  })(request);
}
