import { NextResponse, type NextRequest } from "next/server";
import { signOutCurrentSession, type SessionTerminator } from "@/modules/identity/application/session-terminator";
import { createSessionTerminator } from "@/modules/identity/server";

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

function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const submittedOrigin = new URL(origin);
    const expectedHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? request.nextUrl.host;
    const expectedProtocol = request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");
    return submittedOrigin.host === expectedHost && submittedOrigin.protocol === `${expectedProtocol}:`;
  } catch {
    return false;
  }
}

function redirectToSignIn(request: NextRequest, reason: "signed_out" | "logout_failed"): NextResponse {
  const validatedOrigin = request.headers.get("origin");
  return NextResponse.redirect(new URL(`/sign-in?auth=${reason}`, validatedOrigin ?? request.url), { status: 303 });
}

export const POST = createLogoutHandler({ sessionTerminator: createSessionTerminator() });
