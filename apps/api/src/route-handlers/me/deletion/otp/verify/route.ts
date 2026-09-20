import { getApiRequestContext } from "@api/http/api-context";
import { ApiResponse, type ApiRequest } from "@api/http/api-request";
import { safeParseJsonBody } from "@api/http/validation";
import { z } from "zod";
import { authenticateApplicationMutation } from "@api/shared/infrastructure/authenticated-application-request";
import {
  AccountDeletionChallengeUnavailableError,
  AccountDeletionOtpInvalidError,
  AccountDeletionOtpLockedError,
  createAccountDeletionRepository,
  isBrowserAccountDeletionRequest,
  noStoreHeaders,
  setDeletionAuthorizationCookie,
  type AccountDeletionRepository,
} from "@api/modules/account-deletion/server";

const schema = z.object({ otp: z.string().regex(/^\d{6}$/) }).strict();

type VerifyDeletionOtpDependencies = Readonly<{
  authenticate: typeof authenticateApplicationMutation;
  repository: Pick<AccountDeletionRepository, "verifyPasswordlessOtp">;
}>;

export function createVerifyDeletionOtpHandler({ authenticate, repository }: VerifyDeletionOtpDependencies) {
  return async function POST(request: ApiRequest): Promise<ApiResponse> {
    if (!isBrowserAccountDeletionRequest(request))
      return ApiResponse.json({ error: "same_origin_required" }, { status: 403, headers: noStoreHeaders() });
    const user = await authenticate(request, "account_deletion_authentication", "fresh-provider-user");
    if (user instanceof ApiResponse) return user;
    const parsed = await safeParseJsonBody(request, schema);
    if (!parsed.success)
      return ApiResponse.json({ error: "invalid_deletion_otp" }, { status: 400, headers: noStoreHeaders() });
    try {
      const result = await repository.verifyPasswordlessOtp(user.id, parsed.data.otp, new Date());
      const response = new ApiResponse(null, { status: 204, headers: noStoreHeaders() });
      setDeletionAuthorizationCookie(response.cookies, result.authorizationToken, 600);
      return response;
    } catch (error) {
      if (error instanceof AccountDeletionOtpLockedError)
        return ApiResponse.json({ error: "deletion_otp_locked" }, { status: 429, headers: noStoreHeaders() });
      if (error instanceof AccountDeletionOtpInvalidError || error instanceof AccountDeletionChallengeUnavailableError)
        return ApiResponse.json({ error: "invalid_deletion_otp" }, { status: 400, headers: noStoreHeaders() });
      return ApiResponse.json(
        { error: "deletion_otp_verification_failed" },
        { status: 503, headers: noStoreHeaders() },
      );
    }
  };
}

export async function POST(request: ApiRequest) {
  const context = getApiRequestContext(request);
  return createVerifyDeletionOtpHandler({
    authenticate: authenticateApplicationMutation,
    repository: createAccountDeletionRepository(context.database, context.bindings),
  })(request);
}
