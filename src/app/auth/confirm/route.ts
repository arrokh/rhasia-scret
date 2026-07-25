import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  if (!code && !tokenHash) return redirectToSignIn(request, "missing_code");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return redirectToSignIn(request, "configuration_error");

  const cookieStore = await cookies();
  const client = createServerClient(url, key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
      }
    }
  });
  const { error } = code
    ? await client.auth.exchangeCodeForSession(code)
    : await client.auth.verifyOtp({ token_hash: tokenHash!, type: "email" });
  return error ? redirectToSignIn(request, "verification_failed") : NextResponse.redirect(new URL("/vaults", request.url));
}

function redirectToSignIn(request: NextRequest, reason: string) {
  return NextResponse.redirect(new URL(`/?auth=${reason}`, request.url));
}
