import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { jwtVerify } from "jose";
import type { NextRequest } from "next/server";
import type { AuthConfiguration } from "./auth-backend";
import { BROWSER_E2E_SESSION_COOKIE, browserE2eTestSession } from "./browser-e2e-test-session";
import { OIDC_SESSION_COOKIE } from "./oidc-session-verifier";

type CookieToSet = { name: string; value: string; options: CookieOptions };
export type SetAuthCookies = (cookies: CookieToSet[]) => void;
export type ProxySessionVerifier = (request: NextRequest, setAuthCookies: SetAuthCookies) => Promise<boolean>;

export function createProxySessionVerifier(configuration: AuthConfiguration): ProxySessionVerifier {
  if (configuration.backend === "none") return async () => false;
  if (configuration.backend === "oidc") return createOidcProxySessionVerifier(configuration);
  return createSupabaseProxySessionVerifier();
}

function createSupabaseProxySessionVerifier(): ProxySessionVerifier {
  return async (request, setAuthCookies) => {
    if (browserE2eTestSession(request.cookies.get(BROWSER_E2E_SESSION_COOKIE)?.value)) return true;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) return false;
    try {
      const client = createServerClient(url, key, {
        cookies: { getAll: () => request.cookies.getAll(), setAll: setAuthCookies }
      });
      const { data, error } = await client.auth.getClaims();
      return !error && typeof data?.claims?.sub === "string" && typeof data.claims.iss === "string";
    } catch {
      return false;
    }
  };
}

function createOidcProxySessionVerifier(configuration: Extract<AuthConfiguration, { backend: "oidc" }>): ProxySessionVerifier {
  return async (request) => {
    if (browserE2eTestSession(request.cookies.get(BROWSER_E2E_SESSION_COOKIE)?.value)) return true;
    const token = request.cookies.get(OIDC_SESSION_COOKIE)?.value;
    if (!token) return false;
    try {
      const { payload } = await jwtVerify(token, configuration.oidc.sessionSecret, {
        issuer: "rhasia:oidc-session",
        audience: configuration.oidc.clientId
      });
      return payload.provider_issuer === configuration.oidc.issuer.href.replace(/\/$/, "") && typeof payload.subject === "string" && payload.email_verified === true;
    } catch {
      return false;
    }
  };
}
