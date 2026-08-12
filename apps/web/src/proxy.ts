import { NextResponse, type NextRequest } from "next/server";
import { createIdentityProxyVerifier, type SetAuthCookies } from "@/modules/identity/proxy";
type VerifySession = (request: NextRequest, setAuthCookies: SetAuthCookies) => Promise<boolean>;

const PROTECTED_PAGE_PATHS = ["/totp", "/vaults"] as const;
const SECURITY_HEADERS: Record<string, string> = {
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "X-Permitted-Cross-Domain-Policies": "none"
};

function createCsp(nonce: string): string {
  const developmentScriptPolicy = process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : "";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval'${developmentScriptPolicy}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ].join("; ");
}

function applySecurityHeaders(response: NextResponse, request: NextRequest, nonce: string): NextResponse {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.headers.set(name, value);
  response.headers.set("Content-Security-Policy", createCsp(nonce));
  if (request.nextUrl.pathname.startsWith("/api/") || request.nextUrl.pathname.startsWith("/auth/") || isProtectedPagePath(request.nextUrl.pathname)) {
    response.headers.set("Cache-Control", "no-store, private");
  }
  return response;
}

export function isProtectedPagePath(pathname: string): boolean {
  return PROTECTED_PAGE_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export function createAuthProxy(verifySession: VerifySession = createIdentityProxyVerifier()) {
  return async function authProxy(request: NextRequest) {
    const nonce = btoa(crypto.randomUUID());
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-nonce", nonce);
    const requestWithNonce = { headers: requestHeaders };
    let response = NextResponse.next({ request: requestWithNonce });
    let hasSession = false;
    const verificationStartedAt = performance.now();
    try {
      hasSession = await verifySession(request, (cookiesToSet) => {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request: requestWithNonce });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      });
    } catch {
      hasSession = false;
    }

    const serverTiming = `auth_claims;dur=${Math.max(0, performance.now() - verificationStartedAt).toFixed(2)}`;
    if (!hasSession && isProtectedPagePath(request.nextUrl.pathname)) {
      const redirect = redirectToSignIn(request, response);
      redirect.headers.set("server-timing", serverTiming);
      return applySecurityHeaders(redirect, request, nonce);
    }
    response.headers.set("server-timing", serverTiming);
    return applySecurityHeaders(response, request, nonce);
  };
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
