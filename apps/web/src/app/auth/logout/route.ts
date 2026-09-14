import { NextResponse, type NextRequest } from "next/server";
import { signOutCurrentSession, type SessionTerminator } from "@/modules/identity/application/session-terminator";
import { createSessionTerminator } from "@/modules/identity/server";
import { isSameOrigin, requestPublicOrigin } from "@/modules/identity/infrastructure/request-origin";

type Dependencies = { sessionTerminator: SessionTerminator };

export function createLogoutHandler({ sessionTerminator }: Dependencies) {
  return async function POST(request: NextRequest) {
    if (!isSameOrigin(request)) return new NextResponse(null, { status: 403, headers: noStoreHeaders() });
    try {
      await signOutCurrentSession(sessionTerminator);
      return redirectToSignIn(request, "signed_out");
    } catch {
      return redirectToSignIn(request, "logout_failed");
    }
  };
}

function noStoreHeaders(): Record<string, string> {
  return { "Cache-Control": "no-store" };
}

function redirectToSignIn(request: NextRequest, reason: "signed_out" | "logout_failed"): NextResponse {
  return NextResponse.redirect(new URL(`/sign-in?auth=${reason}`, requestPublicOrigin(request)), { status: 303 });
}

export const POST = createLogoutHandler({ sessionTerminator: createSessionTerminator() });
