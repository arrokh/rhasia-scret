import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { authenticateApplicationMutation } from "@/shared/infrastructure/authenticated-application-request";
import { authBackend } from "@/modules/identity/server";
import {
  createAccountDeletionRepository,
  isBrowserAccountDeletionRequest,
  noStoreHeaders,
  setDeletionOidcChallengeCookie,
  type AccountDeletionRepository,
} from "@/modules/account-deletion/server";

type StartOidcDeletionReauthenticationDependencies = Readonly<{
  authenticate: typeof authenticateApplicationMutation;
  backend: () => ReturnType<typeof authBackend>;
  repository: Pick<AccountDeletionRepository, "createOidcReauthenticationChallenge">;
}>;

export function createStartOidcDeletionReauthenticationHandler({
  authenticate,
  backend,
  repository,
}: StartOidcDeletionReauthenticationDependencies) {
  return async function POST(request: NextRequest): Promise<NextResponse> {
    if (!isBrowserAccountDeletionRequest(request))
      return NextResponse.json({ error: "same_origin_required" }, { status: 403, headers: noStoreHeaders() });
    if (backend() !== "oidc")
      return NextResponse.json(
        { error: "oidc_reauthentication_unavailable" },
        { status: 409, headers: noStoreHeaders() },
      );
    const user = await authenticate("account_deletion_authentication", "fresh-provider-user");
    if (user instanceof NextResponse) return user;
    try {
      const challengeId = await repository.createOidcReauthenticationChallenge(user.id, new Date());
      const cookieStore = await cookies();
      setDeletionOidcChallengeCookie(cookieStore, challengeId);
      return new NextResponse(null, { status: 204, headers: noStoreHeaders() });
    } catch {
      return NextResponse.json(
        { error: "oidc_reauthentication_unavailable" },
        { status: 503, headers: noStoreHeaders() },
      );
    }
  };
}

export const POST = createStartOidcDeletionReauthenticationHandler({
  authenticate: authenticateApplicationMutation,
  backend: authBackend,
  repository: createAccountDeletionRepository(),
});
