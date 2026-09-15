import { NextResponse, type NextRequest } from "next/server";
import { authenticateApplicationMutation } from "@/shared/infrastructure/authenticated-application-request";
import {
  createAccountDeletionEmailSender,
  createAccountDeletionRepository,
  isBrowserAccountDeletionRequest,
  noStoreHeaders,
  type AccountDeletionEmailSender,
  type AccountDeletionRepository,
} from "@/modules/account-deletion/server";
import { authBackend } from "@/modules/identity/server";

export type RequestDeletionOtpDependencies = Readonly<{
  authenticate: typeof authenticateApplicationMutation;
  backend: () => ReturnType<typeof authBackend>;
  repository: Pick<AccountDeletionRepository, "createPasswordlessOtpChallenge">;
  sender: Pick<AccountDeletionEmailSender, "sendDeletionOtpEmail">;
}>;

export function createRequestDeletionOtpHandler({
  authenticate,
  backend,
  repository,
  sender,
}: RequestDeletionOtpDependencies) {
  return async function POST(request: NextRequest): Promise<NextResponse> {
    if (!isBrowserAccountDeletionRequest(request))
      return NextResponse.json({ error: "same_origin_required" }, { status: 403, headers: noStoreHeaders() });
    if (backend() !== "passwordless")
      return NextResponse.json(
        { error: "passwordless_reauthentication_unavailable" },
        { status: 409, headers: noStoreHeaders() },
      );
    const user = await authenticate("account_deletion_authentication", "fresh-provider-user");
    if (user instanceof NextResponse) return user;
    try {
      const challenge = await repository.createPasswordlessOtpChallenge(user.id, new Date());
      await sender.sendDeletionOtpEmail({ recipientEmail: user.email, otp: challenge.otp });
      return new NextResponse(null, { status: 204, headers: noStoreHeaders() });
    } catch {
      return NextResponse.json({ error: "deletion_otp_delivery_failed" }, { status: 503, headers: noStoreHeaders() });
    }
  };
}

export const POST = createRequestDeletionOtpHandler({
  authenticate: authenticateApplicationMutation,
  backend: authBackend,
  repository: createAccountDeletionRepository(),
  sender: createAccountDeletionEmailSender(),
});
