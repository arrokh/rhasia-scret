import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { authBackend, completeSupabaseCallback } from "@/modules/identity/server";

export async function GET(request: NextRequest) {
  try {
    if (authBackend() !== "supabase") return redirectToSignIn(request, "configuration_error");
  } catch {
    return redirectToSignIn(request, "configuration_error");
  }
  const code = request.nextUrl.searchParams.get("code");
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  if (!code && !tokenHash) return redirectToSignIn(request, "missing_code");

  const cookieStore = await cookies();
  const result = await completeSupabaseCallback(code, tokenHash, cookieStore);
  return result === "success" ? NextResponse.redirect(new URL("/vaults", request.url)) : redirectToSignIn(request, result);
}

function redirectToSignIn(request: NextRequest, reason: string) {
  return NextResponse.redirect(new URL(`/sign-in?auth=${reason}`, request.url));
}
