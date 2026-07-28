import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { BROWSER_E2E_SESSION_COOKIE, browserE2eTestSession } from "@/modules/identity/infrastructure/browser-e2e-test-session";

type CookieToSet = { name: string; value: string; options: CookieOptions };
type SetAuthCookies = (cookies: CookieToSet[]) => void;
type VerifySession = (request: NextRequest, setAuthCookies: SetAuthCookies) => Promise<boolean>;

const PROTECTED_PAGE_PATHS = ["/totp", "/vaults"] as const;

export function isProtectedPagePath(pathname: string): boolean {
  return PROTECTED_PAGE_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export function createAuthProxy(verifySession: VerifySession = verifySupabaseSession) {
  return async function authProxy(request: NextRequest) {
    let response = NextResponse.next({ request });
    let hasSession = false;
    try {
      hasSession = await verifySession(request, (cookiesToSet) => {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      });
    } catch {
      hasSession = false;
    }

    if (!hasSession && isProtectedPagePath(request.nextUrl.pathname)) {
      return redirectToSignIn(request, response);
    }
    return response;
  };
}

async function verifySupabaseSession(request: NextRequest, setAuthCookies: SetAuthCookies): Promise<boolean> {
  if (browserE2eTestSession(request.cookies.get(BROWSER_E2E_SESSION_COOKIE)?.value)) return true;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return false;

  try {
    const client = createServerClient(url, key, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: setAuthCookies
      }
    });
    const { data, error } = await client.auth.getClaims();
    return !error && typeof data?.claims?.sub === "string" && data.claims.sub.length > 0;
  } catch {
    return false;
  }
}

function redirectToSignIn(request: NextRequest, refreshedResponse: NextResponse): NextResponse {
  const response = NextResponse.redirect(new URL("/sign-in?auth=required", request.url));
  for (const cookie of refreshedResponse.cookies.getAll()) response.cookies.set(cookie);
  return response;
}

export const proxy = createAuthProxy();

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"]
};
