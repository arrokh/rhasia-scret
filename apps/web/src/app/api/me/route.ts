import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  authenticateApplicationMutation,
  authenticateApplicationReader,
} from "@/shared/infrastructure/authenticated-application-request";
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
  type AccountDeletionRequest,
} from "@/modules/account-deletion/server";
import { createSessionTerminator } from "@/modules/identity/server";

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
  authenticateReader: typeof authenticateApplicationReader;
  authenticateMutation: typeof authenticateApplicationMutation;
  repository: AccountDeletionRepository;
  sender: Pick<AccountDeletionEmailSender, "sendDeletionCompletionEmail">;
  terminateSession: () => Promise<void>;
  now: () => Date;
}>;

export function createGetMeHandler({ authenticate }: { authenticate: typeof authenticateApplicationReader }) {
  return async function GET() {
    const user = await authenticate("fresh-provider-user");
    if (user instanceof NextResponse) return user;
    return NextResponse.json({ id: user.id, email: user.email });
  };
}

export function createDeleteMeHandler({
  authenticateMutation,
  repository,
  sender,
  terminateSession,
  now,
}: Omit<Dependencies, "authenticateReader">) {
  return async function DELETE(request: NextRequest): Promise<NextResponse> {
    if (!isBrowserAccountDeletionRequest(request))
      return NextResponse.json({ error: "same_origin_required" }, { status: 403, headers: noStoreHeaders() });
    const cookieStore = await cookies();
    const authorizationToken = cookieStore.get(ACCOUNT_DELETION_AUTHORIZATION_COOKIE)?.value;
    if (!authorizationToken || !/^[A-Za-z0-9_-]{43,128}$/.test(authorizationToken))
      return NextResponse.json(
        { error: "deletion_reauthentication_required" },
        { status: 401, headers: noStoreHeaders() },
      );

    const completed = await repository.findCompletedDeletion(authorizationToken);
    if (completed) {
      clearDeletionCookies(cookieStore);
      return NextResponse.json(
        { receiptId: completed.receiptId, emailDelivery: completed.emailDeliveryStatus.toLowerCase() },
        { headers: noStoreHeaders() },
      );
    }

    const user = await authenticateMutation("destructive_mutation", "fresh-provider-user");
    if (user instanceof NextResponse) return user;
    const parsed = deletionRequestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success)
      return NextResponse.json({ error: "invalid_deletion_request" }, { status: 400, headers: noStoreHeaders() });
    const authBackend = user.issuer === "rhasia:passwordless" ? "passwordless" : "oidc";
    try {
      const result = await repository.deleteUser(
        user.id,
        authorizationToken,
        authBackend,
        parsed.data as AccountDeletionRequest,
        now(),
      );
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
      try {
        await terminateSession();
      } catch {
        // The response still clears cookies below; browser storage cleanup is client-owned.
      }
      clearDeletionCookies(cookieStore);
      return NextResponse.json({ receiptId: result.receiptId, emailDelivery }, { headers: noStoreHeaders() });
    } catch (error) {
      if (error instanceof AccountDeletionAuthorizationError)
        return NextResponse.json(
          { error: "deletion_reauthentication_required" },
          { status: 401, headers: noStoreHeaders() },
        );
      if (error instanceof AccountDeletionPlanStaleError)
        return NextResponse.json({ error: "deletion_plan_stale" }, { status: 409, headers: noStoreHeaders() });
      if (
        error instanceof Error &&
        [
          "invalid_confirmation",
          "acknowledgement_required",
          "invalid_vault_decisions",
          "invalid_transfer_target",
        ].includes(error.message)
      )
        return NextResponse.json({ error: error.message }, { status: 400, headers: noStoreHeaders() });
      return NextResponse.json({ error: "account_deletion_failed" }, { status: 503, headers: noStoreHeaders() });
    }
  };
}

export const GET = createGetMeHandler({ authenticate: authenticateApplicationReader });
export const DELETE = createDeleteMeHandler({
  authenticateMutation: authenticateApplicationMutation,
  repository: createAccountDeletionRepository(),
  sender: createAccountDeletionEmailSender(),
  terminateSession: () => createSessionTerminator().terminateCurrentSession(),
  now: () => new Date(),
});
