import { jwtVerify } from "jose";
import type { NextRequest } from "next/server";
import { BROWSER_E2E_SESSION_COOKIE, browserE2eTestSession } from "./browser-e2e-test-session";
import {
  PASSWORDLESS_ASSERTION_AUDIENCE,
  PASSWORDLESS_ASSERTION_COOKIE,
  PASSWORDLESS_ASSERTION_ISSUER,
} from "./passwordless-session";

export type SetAuthCookies = (
  cookies: Array<{ name: string; value: string; options: Record<string, unknown> }>,
) => void;
export type ProxyAuthConfiguration = { backend: "none" } | { backend: "passwordless"; sessionSecret: Uint8Array };
export type ProxySessionVerification = boolean | "configuration_error";
export type ProxySessionVerifier = (
  request: NextRequest,
  setAuthCookies: SetAuthCookies,
) => Promise<ProxySessionVerification>;

export function createProxySessionVerifier(configuration: ProxyAuthConfiguration): ProxySessionVerifier {
  if (configuration.backend === "none") return async () => false;
  return createPasswordlessProxySessionVerifier(configuration);
}

function createPasswordlessProxySessionVerifier(
  configuration: Extract<ProxyAuthConfiguration, { backend: "passwordless" }>,
): ProxySessionVerifier {
  return async (request) => {
    if (browserE2eTestSession(request.cookies.get(BROWSER_E2E_SESSION_COOKIE)?.value)) return true;
    const assertion = request.cookies.get(PASSWORDLESS_ASSERTION_COOKIE)?.value;
    if (!assertion) return false;
    try {
      const { payload } = await jwtVerify(assertion, configuration.sessionSecret, {
        issuer: PASSWORDLESS_ASSERTION_ISSUER,
        audience: PASSWORDLESS_ASSERTION_AUDIENCE,
      });
      return typeof payload.session_id === "string" && /^[A-Za-z0-9_-]{16,128}$/.test(payload.session_id);
    } catch {
      return false;
    }
  };
}
