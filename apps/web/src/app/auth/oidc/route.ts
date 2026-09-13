import { NextResponse } from "next/server";
import { readAuthConfiguration } from "@/modules/identity/infrastructure/auth-backend";
import { createOidcAuthorizationRequest } from "@/modules/identity/infrastructure/oidc-client";
import { DEFAULT_AUTH_RETURN_PATH, resolveAuthReturnPath } from "@/modules/identity/application/auth-return-path";
import {
  OIDC_NONCE_COOKIE,
  OIDC_RETURN_PATH_COOKIE,
  OIDC_STATE_COOKIE,
  OIDC_VERIFIER_COOKIE,
} from "@/modules/identity/infrastructure/oidc-session-verifier";
import { cookies } from "next/headers";

export async function GET(request: Request): Promise<Response> {
  const nextPath = resolveAuthReturnPath(new URL(request.url).searchParams.get("next"));
  try {
    const configuration = readAuthConfiguration();
    if (configuration.backend !== "oidc") return redirect(request, "configuration_error", nextPath);
    const authorization = await createOidcAuthorizationRequest(configuration.oidc);
    const cookieStore = await cookies();
    const options = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax" as const,
      maxAge: 600,
      path: "/",
    };
    cookieStore.set(OIDC_STATE_COOKIE, authorization.state, options);
    cookieStore.set(OIDC_NONCE_COOKIE, authorization.nonce, options);
    cookieStore.set(OIDC_VERIFIER_COOKIE, authorization.verifier, options);
    cookieStore.set(OIDC_RETURN_PATH_COOKIE, nextPath, options);
    return NextResponse.redirect(authorization.url);
  } catch {
    return redirect(request, "configuration_error", nextPath);
  }
}

function redirect(request: Request, reason: "configuration_error", nextPath = DEFAULT_AUTH_RETURN_PATH): NextResponse {
  const destination = new URL("/sign-in", request.url);
  destination.searchParams.set("auth", reason);
  if (nextPath !== DEFAULT_AUTH_RETURN_PATH) destination.searchParams.set("next", nextPath);
  return NextResponse.redirect(destination);
}
