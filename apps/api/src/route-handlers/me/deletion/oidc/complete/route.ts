import { getApiRequestContext } from "@api/http/api-context";
import { ApiResponse, type ApiRequest } from "@api/http/api-request";
import {
  ACCOUNT_DELETION_OIDC_CHALLENGE_COOKIE,
  createAccountDeletionRepository,
  isBrowserAccountDeletionRequest,
  setDeletionAuthorizationCookie,
  type AccountDeletionRepository,
} from "@api/modules/account-deletion/server";

export function createCompleteOidcDeletionReauthenticationHandler({
  repository,
  now = () => new Date(),
}: Readonly<{
  repository: Pick<AccountDeletionRepository, "completeOidcReauthentication">;
  now?: () => Date;
}>) {
  return async function POST(request: ApiRequest): Promise<ApiResponse> {
    if (!isBrowserAccountDeletionRequest(request))
      return ApiResponse.json({ error: "same_origin_required" }, { status: 403 });
    const context = getApiRequestContext(request);
    if (context.bindings.AUTH_BACKEND !== "oidc")
      return ApiResponse.json({ error: "oidc_reauthentication_unavailable" }, { status: 409 });
    const principal = await context.sessionVerifier.verify(request, "fresh-provider-user");
    if (!principal) return ApiResponse.json({ error: "unauthenticated" }, { status: 401 });
    const challengeId = request.cookies.get(ACCOUNT_DELETION_OIDC_CHALLENGE_COOKIE)?.value;
    if (!challengeId) return ApiResponse.json({ error: "oidc_reauthentication_unavailable" }, { status: 409 });
    try {
      const result = await repository.completeOidcReauthentication(
        challengeId,
        principal.issuer,
        principal.subject,
        now(),
      );
      const response = new ApiResponse(null, { status: 204, headers: { "cache-control": "no-store" } });
      setDeletionAuthorizationCookie(response.cookies, result.authorizationToken, 600);
      return response;
    } catch {
      return ApiResponse.json({ error: "oidc_reauthentication_unavailable" }, { status: 503 });
    }
  };
}

export async function POST(request: ApiRequest) {
  const context = getApiRequestContext(request);
  return createCompleteOidcDeletionReauthenticationHandler({
    repository: createAccountDeletionRepository(context.database, context.bindings),
  })(request);
}
