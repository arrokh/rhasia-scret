import { NextResponse } from "next/server";
import { readAuthConfiguration } from "@/modules/identity/infrastructure/auth-backend";
import { createOidcAuthorizationRequest } from "@/modules/identity/infrastructure/oidc-client";
import { OIDC_NONCE_COOKIE, OIDC_STATE_COOKIE, OIDC_VERIFIER_COOKIE } from "@/modules/identity/infrastructure/oidc-session-verifier";
import { cookies } from "next/headers";

export async function GET(request: Request): Promise<Response> {
  try {
    const configuration = readAuthConfiguration();
    if (configuration.backend !== "oidc") return redirect(request, "configuration_error");
    const authorization = await createOidcAuthorizationRequest(configuration.oidc);
    const cookieStore = await cookies();
    const options = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, maxAge: 600, path: "/" };
    cookieStore.set(OIDC_STATE_COOKIE, authorization.state, options);
    cookieStore.set(OIDC_NONCE_COOKIE, authorization.nonce, options);
    cookieStore.set(OIDC_VERIFIER_COOKIE, authorization.verifier, options);
    return NextResponse.redirect(authorization.url);
  } catch {
    return redirect(request, "configuration_error");
  }
}

function redirect(request: Request, reason: "configuration_error"): NextResponse {
  return NextResponse.redirect(new URL(`/sign-in?auth=${reason}`, request.url));
}
