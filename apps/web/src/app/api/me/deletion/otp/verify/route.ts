import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { authenticateApplicationMutation } from "@/shared/infrastructure/authenticated-application-request";
import {
  AccountDeletionChallengeUnavailableError,
  AccountDeletionOtpInvalidError,
  AccountDeletionOtpLockedError,
  createAccountDeletionRepository,
  isBrowserAccountDeletionRequest,
  noStoreHeaders,
  setDeletionAuthorizationCookie,
  type AccountDeletionRepository,
} from "@/modules/account-deletion/server";

const schema = z.object({ otp: z.string().regex(/^\d{6}$/) });

type VerifyDeletionOtpDependencies = Readonly<{
  authenticate: typeof authenticateApplicationMutation;
  repository: Pick<AccountDeletionRepository, "verifyPasswordlessOtp">;
}>;

export function createVerifyDeletionOtpHandler({ authenticate, repository }: VerifyDeletionOtpDependencies) {
  return async function POST(request: NextRequest): Promise<NextResponse> {
    if (!isBrowserAccountDeletionRequest(request))
      return NextResponse.json({ error: "same_origin_required" }, { status: 403, headers: noStoreHeaders() });
    const user = await authenticate("account_deletion_authentication", "fresh-provider-user");
    if (user instanceof NextResponse) return user;
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success)
      return NextResponse.json({ error: "invalid_deletion_otp" }, { status: 400, headers: noStoreHeaders() });
    try {
      const result = await repository.verifyPasswordlessOtp(user.id, parsed.data.otp, new Date());
      const response = new NextResponse(null, { status: 204, headers: noStoreHeaders() });
      const cookieStore = await import("next/headers").then(({ cookies }) => cookies());
      setDeletionAuthorizationCookie(cookieStore, result.authorizationToken, 600);
      return response;
    } catch (error) {
      if (error instanceof AccountDeletionOtpLockedError)
        return NextResponse.json({ error: "deletion_otp_locked" }, { status: 429, headers: noStoreHeaders() });
      if (error instanceof AccountDeletionOtpInvalidError || error instanceof AccountDeletionChallengeUnavailableError)
        return NextResponse.json({ error: "invalid_deletion_otp" }, { status: 400, headers: noStoreHeaders() });
      return NextResponse.json(
        { error: "deletion_otp_verification_failed" },
        { status: 503, headers: noStoreHeaders() },
      );
    }
  };
}

export const POST = createVerifyDeletionOtpHandler({
  authenticate: authenticateApplicationMutation,
  repository: createAccountDeletionRepository(),
});
