import { getApiRequestContext } from "@api/http/api-context";
import { ApiResponse, type ApiRequest } from "@api/http/api-request";
import { authenticateApplicationMutation } from "@api/shared/infrastructure/authenticated-application-request";
import {
  createAccountDeletionRepository,
  isBrowserAccountDeletionRequest,
  noStoreHeaders,
  type AccountDeletionEmailSender,
  type AccountDeletionRepository,
} from "@api/modules/account-deletion/server";
import { authBackend } from "@api/modules/identity/server";

export type RequestDeletionOtpDependencies = Readonly<{
  authenticate: typeof authenticateApplicationMutation;
  backend: (request: ApiRequest) => ReturnType<typeof authBackend>;
  repository: Pick<AccountDeletionRepository, "createPasswordlessOtpChallenge">;
  sender: Pick<AccountDeletionEmailSender, "sendDeletionOtpEmail">;
}>;

export function createRequestDeletionOtpHandler({
  authenticate,
  backend,
  repository,
  sender,
}: RequestDeletionOtpDependencies) {
  return async function POST(request: ApiRequest): Promise<ApiResponse> {
    if (!isBrowserAccountDeletionRequest(request))
      return ApiResponse.json({ error: "same_origin_required" }, { status: 403, headers: noStoreHeaders() });
    if (backend(request) !== "passwordless")
      return ApiResponse.json(
        { error: "passwordless_reauthentication_unavailable" },
        { status: 409, headers: noStoreHeaders() },
      );
    const user = await authenticate(request, "account_deletion_authentication", "fresh-provider-user");
    if (user instanceof ApiResponse) return user;
    try {
      const challenge = await repository.createPasswordlessOtpChallenge(user.id, new Date());
      await sender.sendDeletionOtpEmail({ recipientEmail: user.email, otp: challenge.otp });
      return new ApiResponse(null, { status: 204, headers: noStoreHeaders() });
    } catch {
      return ApiResponse.json({ error: "deletion_otp_delivery_failed" }, { status: 503, headers: noStoreHeaders() });
    }
  };
}

export async function POST(request: ApiRequest) {
  const context = getApiRequestContext(request);
  return createRequestDeletionOtpHandler({
    authenticate: authenticateApplicationMutation,
    backend: () => authBackend(context.bindings),
    repository: createAccountDeletionRepository(context.database, context.bindings),
    sender: context.emailSenders.accountDeletion,
  })(request);
}
