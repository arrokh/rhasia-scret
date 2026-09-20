import { NextResponse, type NextRequest } from "next/server";
import { isSameOrigin, requestPublicOrigin } from "@/modules/identity/infrastructure/request-origin";
import { requestApi } from "@/shared/infrastructure/server-api-gateway";

export function createLogoutHandler() {
  return async function POST(request: NextRequest) {
    if (!isSameOrigin(request)) return new NextResponse(null, { status: 403, headers: noStoreHeaders() });
    try {
      const response = await requestApi("/v1/auth/session/revoke", { method: "POST" });
      const nextResponse = redirectToSignIn(request, response.ok ? "signed_out" : "logout_failed");
      for (const cookie of response.headers.getSetCookie()) nextResponse.headers.append("set-cookie", cookie);
      return nextResponse;
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

export const POST = createLogoutHandler();
