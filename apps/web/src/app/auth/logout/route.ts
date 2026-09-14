import { NextResponse, type NextRequest } from "next/server";
import { signOutCurrentSession, type SessionTerminator } from "@/modules/identity/application/session-terminator";
import { createSessionTerminator } from "@/modules/identity/server";
import { isSameOrigin } from "@/modules/identity/infrastructure/request-origin";

type Dependencies = { sessionTerminator: SessionTerminator };

export function createLogoutHandler({ sessionTerminator }: Dependencies) {
  return async function POST(request: NextRequest) {
    if (!isSameOrigin(request)) return new NextResponse(null, { status: 403 });
    try {
      await signOutCurrentSession(sessionTerminator);
      return redirectToSignIn(request, "signed_out");
    } catch {
      return redirectToSignIn(request, "logout_failed");
    }
  };
}

function redirectToSignIn(request: NextRequest, reason: "signed_out" | "logout_failed"): NextResponse {
  const validatedOrigin = request.headers.get("origin");
  return NextResponse.redirect(new URL(`/sign-in?auth=${reason}`, validatedOrigin ?? request.url), { status: 303 });
}

export const POST = createLogoutHandler({ sessionTerminator: createSessionTerminator() });
