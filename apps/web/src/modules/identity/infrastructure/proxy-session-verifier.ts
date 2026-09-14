import { jwtVerify } from "jose";
import type { NextRequest } from "next/server";
import type { AuthConfiguration } from "./auth-backend";
import { BROWSER_E2E_SESSION_COOKIE, browserE2eTestSession } from "./browser-e2e-test-session";
import {
  PASSWORDLESS_ASSERTION_AUDIENCE,
  PASSWORDLESS_ASSERTION_COOKIE,
  PASSWORDLESS_ASSERTION_ISSUER,
} from "./passwordless-session";
import { OIDC_SESSION_COOKIE } from "./oidc-session-verifier";

export type SetAuthCookies = (
  cookies: Array<{ name: string; value: string; options: Record<string, unknown> }>,
) => void;
export type ProxySessionVerifier = (request: NextRequest, setAuthCookies: SetAuthCookies) => Promise<boolean>;

export function createProxySessionVerifier(configuration: AuthConfiguration): ProxySessionVerifier {
  if (configuration.backend === "none") return async () => false;
  if (configuration.backend === "oidc") return createOidcProxySessionVerifier(configuration);
  return createPasswordlessProxySessionVerifier(configuration);
}

function createPasswordlessProxySessionVerifier(
  configuration: Extract<AuthConfiguration, { backend: "passwordless" }>,
): ProxySessionVerifier {
  return async (request) => {
    if (browserE2eTestSession(request.cookies.get(BROWSER_E2E_SESSION_COOKIE)?.value)) return true;
    const assertion = request.cookies.get(PASSWORDLESS_ASSERTION_COOKIE)?.value;
    if (!assertion) return false;
    try {
      const { payload } = await jwtVerify(assertion, configuration.passwordless.sessionSecret, {
        issuer: PASSWORDLESS_ASSERTION_ISSUER,
        audience: PASSWORDLESS_ASSERTION_AUDIENCE,
      });
      return typeof payload.session_id === "string" && /^[A-Za-z0-9_-]{16,128}$/.test(payload.session_id);
    } catch {
      return false;
    }
  };
}

function createOidcProxySessionVerifier(
  configuration: Extract<AuthConfiguration, { backend: "oidc" }>,
): ProxySessionVerifier {
  return async (request) => {
    if (browserE2eTestSession(request.cookies.get(BROWSER_E2E_SESSION_COOKIE)?.value)) return true;
    const token = request.cookies.get(OIDC_SESSION_COOKIE)?.value;
    if (!token) return false;
    try {
      const { payload } = await jwtVerify(token, configuration.oidc.sessionSecret, {
        issuer: "rhasia:oidc-session",
        audience: configuration.oidc.clientId,
      });
      return (
        payload.provider_issuer === configuration.oidc.issuer.href.replace(/\/$/, "") &&
        typeof payload.subject === "string" &&
        payload.email_verified === true
      );
    } catch {
      return false;
    }
  };
}
