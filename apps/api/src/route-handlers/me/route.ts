import { getApiRequestContext } from "@api/http/api-context";
import { ApiResponse, type ApiRequest } from "@api/http/api-request";
import { z } from "zod";
import {
  authenticateApplicationMutation,
  authenticateApplicationReader,
} from "@api/shared/infrastructure/authenticated-application-request";
import {
  ACCOUNT_DELETION_AUTHORIZATION_COOKIE,
  AccountDeletionAuthorizationError,
  AccountDeletionPlanStaleError,
  clearDeletionCookies,
  createAccountDeletionEmailSender,
  createAccountDeletionRepository,
  isBrowserAccountDeletionRequest,
  noStoreHeaders,
  type AccountDeletionEmailSender,
  type AccountDeletionRepository,
} from "@api/modules/account-deletion/server";

const deletionRequestSchema = z
  .object({
    confirmation: z.string(),
    acknowledged: z.boolean(),
    vaultDecisions: z
      .array(
        z
          .object({
            vaultId: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
            action: z.enum(["DELETE", "TRANSFER"]),
            transferToUserId: z
              .string()
              .regex(/^[A-Za-z0-9_-]{16,128}$/)
              .optional(),
          })
          .strict(),
      )
      .max(128),
  })
  .strict();

type Dependencies = Readonly<{
  authenticateMutation: typeof authenticateApplicationMutation;
  repository: AccountDeletionRepository;
  sender: Pick<AccountDeletionEmailSender, "sendDeletionCompletionEmail">;
  terminateSession: (request: ApiRequest, cookies: ApiResponse["cookies"]) => Promise<void>;
  now: () => Date;
}>;

export function createGetMeHandler({ authenticate }: { authenticate: typeof authenticateApplicationReader }) {
  return async function GET(request: ApiRequest) {
    const user = await authenticate(request, "fresh-provider-user");
    if (user instanceof ApiResponse) return user;
    return ApiResponse.json({ id: user.id, email: user.email });
  };
}

export function createDeleteMeHandler({
  authenticateMutation,
  repository,
  sender,
  terminateSession,
  now,
}: Dependencies) {
  return async function DELETE(request: ApiRequest): Promise<ApiResponse> {
    if (!isBrowserAccountDeletionRequest(request))
      return ApiResponse.json({ error: "same_origin_required" }, { status: 403, headers: noStoreHeaders() });
    const authorizationToken = request.cookies.get(ACCOUNT_DELETION_AUTHORIZATION_COOKIE)?.value;
    if (!authorizationToken || !/^[A-Za-z0-9_-]{43,128}$/.test(authorizationToken))
      return ApiResponse.json(
        { error: "deletion_reauthentication_required" },
        { status: 401, headers: noStoreHeaders() },
      );

    const completed = await repository.findCompletedDeletion(authorizationToken);
    if (completed) {
      const response = ApiResponse.json(
        { receiptId: completed.receiptId, emailDelivery: completed.emailDeliveryStatus.toLowerCase() },
        { headers: noStoreHeaders() },
      );
      clearDeletionCookies(response.cookies);
      return response;
    }

    const user = await authenticateMutation(request, "destructive_mutation", "fresh-provider-user");
    if (user instanceof ApiResponse) return user;
    const parsed = deletionRequestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success)
      return ApiResponse.json({ error: "invalid_deletion_request" }, { status: 400, headers: noStoreHeaders() });
    const authBackend = user.issuer === "rhasia:passwordless" ? "passwordless" : "oidc";
    try {
      const result = await repository.deleteUser(user.id, authorizationToken, authBackend, parsed.data, now());
      let emailDelivery = "failed";
      try {
        await sender.sendDeletionCompletionEmail({ recipientEmail: result.email, receiptId: result.receiptId });
        await repository.recordCompletionEmailStatus(result.receiptId, "SENT");
        emailDelivery = "sent";
      } catch {
        try {
          await repository.recordCompletionEmailStatus(result.receiptId, "FAILED");
        } catch {
          // The deletion is already committed; email delivery remains best-effort.
        }
      }
      const response = ApiResponse.json({ receiptId: result.receiptId, emailDelivery }, { headers: noStoreHeaders() });
      try {
        await terminateSession(request, response.cookies);
      } catch {
        // The response still clears cookies below; browser storage cleanup is client-owned.
      }
      clearDeletionCookies(response.cookies);
      return response;
    } catch (error) {
      if (error instanceof AccountDeletionAuthorizationError)
        return ApiResponse.json(
          { error: "deletion_reauthentication_required" },
          { status: 401, headers: noStoreHeaders() },
        );
      if (error instanceof AccountDeletionPlanStaleError)
        return ApiResponse.json({ error: "deletion_plan_stale" }, { status: 409, headers: noStoreHeaders() });
      if (
        error instanceof Error &&
        [
          "invalid_confirmation",
          "acknowledgement_required",
          "invalid_vault_decisions",
          "invalid_transfer_target",
        ].includes(error.message)
      )
        return ApiResponse.json({ error: error.message }, { status: 400, headers: noStoreHeaders() });
      return ApiResponse.json({ error: "account_deletion_failed" }, { status: 503, headers: noStoreHeaders() });
    }
  };
}

export async function GET(request: ApiRequest) {
  return createGetMeHandler({ authenticate: authenticateApplicationReader })(request);
}

export async function DELETE(request: ApiRequest) {
  const context = getApiRequestContext(request);
  return createDeleteMeHandler({
    authenticateMutation: authenticateApplicationMutation,
    repository: createAccountDeletionRepository(context.database, context.bindings),
    sender: createAccountDeletionEmailSender(context.bindings),
    terminateSession: (currentRequest, cookies) =>
      context.sessionTerminator.terminateCurrentSession(currentRequest, cookies),
    now: () => new Date(),
  })(request);
}
