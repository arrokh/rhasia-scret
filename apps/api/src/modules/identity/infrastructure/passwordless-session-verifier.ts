import type { PasswordlessAuthService } from "../application/passwordless-authentication";
import type { SessionAssurance, SessionVerifier, VerifiedPrincipal } from "../application/session-verifier";
import { assuranceSatisfies } from "../application/session-verifier";
import type { PasswordlessConfiguration } from "./auth-backend";
import {
  PASSWORDLESS_ACCESS_COOKIE,
  PASSWORDLESS_ASSERTION_COOKIE,
  verifyPasswordlessBrowserAssertion,
} from "./passwordless-session";

export class PasswordlessSessionVerifier implements SessionVerifier {
  public constructor(
    private readonly service: PasswordlessAuthService,
    private readonly configuration: PasswordlessConfiguration,
  ) {}

  public async verify(
    request: Request,
    minimumAssurance: SessionAssurance = "fresh-provider-user",
  ): Promise<VerifiedPrincipal | null> {
    if (request.headers.has("authorization")) return null;

    const cookies = parseCookies(request.headers.get("cookie"));
    const hasBrowserCredential = cookies.has(PASSWORDLESS_ASSERTION_COOKIE) || cookies.has(PASSWORDLESS_ACCESS_COOKIE);
    if (!hasBrowserCredential || !request.headers.has("x-rhasia-proxy-secret")) return null;

    return this.verifyCookieSession(cookies, minimumAssurance);
  }

  private async verifyCookieSession(
    cookies: ReadonlyMap<string, string>,
    minimumAssurance: SessionAssurance,
  ): Promise<VerifiedPrincipal | null> {
    const assertion = cookies.get(PASSWORDLESS_ASSERTION_COOKIE);
    if (assertion) {
      const sessionId = await verifyPasswordlessBrowserAssertion(this.configuration, assertion);
      if (!sessionId) return null;
      const principal = await this.service.verifyBrowserSession(sessionId);
      return principal && assuranceSatisfies(principal.assurance, minimumAssurance) ? principal : null;
    }

    const accessToken = cookies.get(PASSWORDLESS_ACCESS_COOKIE);
    if (!accessToken) return null;
    const principal = await this.service.verifyAccessToken(accessToken);
    return principal && assuranceSatisfies(principal.assurance, minimumAssurance) ? principal : null;
  }
}

function parseCookies(value: string | null): Map<string, string> {
  const result = new Map<string, string>();
  for (const pair of value?.split(";") ?? []) {
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;
    result.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim());
  }
  return result;
}
