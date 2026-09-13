import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readAuthConfiguration } from "@/modules/identity/infrastructure/auth-backend";
import { completeOidcAuthorization } from "@/modules/identity/infrastructure/oidc-client";
import {
  AUTH_COMPLETION_PATH,
  DEFAULT_AUTH_RETURN_PATH,
  INVITATION_AUTH_RETURN_PATH,
  resolveAuthReturnPath,
} from "@/modules/identity/application/auth-return-path";
import {
  OIDC_NONCE_COOKIE,
  OIDC_RETURN_PATH_COOKIE,
  OIDC_SESSION_COOKIE,
  OIDC_STATE_COOKIE,
  OIDC_VERIFIER_COOKIE,
  signOidcSession,
} from "@/modules/identity/infrastructure/oidc-session-verifier";

export async function GET(request: Request): Promise<Response> {
  const nextPathFromRequest = resolveAuthReturnPath(new URL(request.url).searchParams.get("next"));
  let nextPath = nextPathFromRequest;
  try {
    const configuration = readAuthConfiguration();
    if (configuration.backend !== "oidc") return redirect(request, "configuration_error", nextPath);
    const cookieStore = await cookies();
    const state = cookieStore.get(OIDC_STATE_COOKIE)?.value;
    const nonce = cookieStore.get(OIDC_NONCE_COOKIE)?.value;
    const verifier = cookieStore.get(OIDC_VERIFIER_COOKIE)?.value;
    nextPath = resolveAuthReturnPath(cookieStore.get(OIDC_RETURN_PATH_COOKIE)?.value ?? nextPathFromRequest);
    const callbackUrl = new URL(request.url);
    if (!state || !nonce || !verifier || callbackUrl.searchParams.has("error"))
      return redirect(request, "verification_failed", nextPath);
    const result = await completeOidcAuthorization(configuration.oidc, callbackUrl, state, nonce, verifier);
    const token = await signOidcSession(configuration.oidc, result.principal, result.expiresAt);
    cookieStore.set(OIDC_SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: Math.max(1, result.expiresAt - Math.floor(Date.now() / 1000)),
      path: "/",
    });
    clearCallbackCookies(cookieStore);
    return NextResponse.redirect(
      new URL(nextPath === INVITATION_AUTH_RETURN_PATH ? AUTH_COMPLETION_PATH : nextPath, request.url),
    );
  } catch {
    return redirect(request, "verification_failed", nextPath);
  }
}

function clearCallbackCookies(cookieStore: Awaited<ReturnType<typeof cookies>>): void {
  for (const name of [OIDC_STATE_COOKIE, OIDC_NONCE_COOKIE, OIDC_VERIFIER_COOKIE, OIDC_RETURN_PATH_COOKIE]) {
    cookieStore.set(name, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 0,
      path: "/",
    });
  }
}

function redirect(
  request: Request,
  reason: "configuration_error" | "verification_failed",
  nextPath = DEFAULT_AUTH_RETURN_PATH,
): NextResponse {
  const destination = new URL("/sign-in", request.url);
  destination.searchParams.set("auth", reason);
  if (nextPath !== DEFAULT_AUTH_RETURN_PATH) destination.searchParams.set("next", nextPath);
  return NextResponse.redirect(destination);
}
