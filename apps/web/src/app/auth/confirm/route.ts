import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { authBackend, completeSupabaseCallback } from "@/modules/identity/server";
import {
  AUTH_COMPLETION_PATH,
  AUTH_RETURN_PATH_COOKIE,
  DEFAULT_AUTH_RETURN_PATH,
  INVITATION_AUTH_RETURN_PATH,
  resolveAuthReturnPath,
  type AuthReturnPath,
} from "@/modules/identity/application/auth-return-path";

export async function GET(request: NextRequest) {
  const nextPathFromRequest = resolveAuthReturnPath(request.nextUrl.searchParams.get("next"));
  let nextPath = nextPathFromRequest;
  let cookieStore: Awaited<ReturnType<typeof cookies>> | undefined;
  try {
    cookieStore = await cookies();
    nextPath = resolveAuthReturnPath(
      request.nextUrl.searchParams.get("next") ?? cookieStore.get(AUTH_RETURN_PATH_COOKIE)?.value,
    );
    if (authBackend() !== "supabase") {
      clearAuthReturnPathCookie(cookieStore);
      return redirectToSignIn(request, "configuration_error", nextPath);
    }
  } catch {
    if (cookieStore) clearAuthReturnPathCookie(cookieStore);
    return redirectToSignIn(request, "configuration_error", nextPathFromRequest);
  }
  const code = request.nextUrl.searchParams.get("code");
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  if (!cookieStore) return redirectToSignIn(request, "configuration_error", nextPath);
  const result = await completeSupabaseCallback(code, tokenHash, cookieStore);
  clearAuthReturnPathCookie(cookieStore);
  return result === "success"
    ? NextResponse.redirect(
        new URL(nextPath === INVITATION_AUTH_RETURN_PATH ? AUTH_COMPLETION_PATH : nextPath, request.url),
      )
    : redirectToSignIn(request, result, nextPath);
}

function redirectToSignIn(request: NextRequest, reason: string, nextPath: AuthReturnPath = DEFAULT_AUTH_RETURN_PATH) {
  const destination = new URL("/sign-in", request.url);
  destination.searchParams.set("auth", reason);
  if (nextPath !== DEFAULT_AUTH_RETURN_PATH) destination.searchParams.set("next", nextPath);
  return NextResponse.redirect(destination);
}

function clearAuthReturnPathCookie(cookieStore: Awaited<ReturnType<typeof cookies>>): void {
  cookieStore.set(AUTH_RETURN_PATH_COOKIE, "", {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
}
