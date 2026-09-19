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
    const bearerToken = readBearerToken(request.headers.get("authorization"));
    const cookies = parseCookies(request.headers.get("cookie"));
    const hasBrowserCredential = cookies.has(PASSWORDLESS_ASSERTION_COOKIE) || cookies.has(PASSWORDLESS_ACCESS_COOKIE);
    if (hasBrowserCredential && !request.headers.has("x-rhasia-proxy-secret")) return null;

    const bearerPrincipal =
      bearerToken !== undefined ? await this.verifyAndSatisfy(bearerToken, minimumAssurance) : null;
    if (bearerToken !== undefined && !hasBrowserCredential) return bearerPrincipal;
    if (bearerToken !== undefined && !bearerPrincipal) return null;

    const cookiePrincipal = hasBrowserCredential ? await this.verifyCookieSession(cookies, minimumAssurance) : null;
    if (bearerToken !== undefined) {
      return bearerPrincipal?.sessionId && cookiePrincipal?.sessionId === bearerPrincipal.sessionId
        ? bearerPrincipal
        : null;
    }
    return cookiePrincipal;
  }

  private async verifyAndSatisfy(token: string, minimumAssurance: SessionAssurance): Promise<VerifiedPrincipal | null> {
    const principal = await this.service.verifyAccessToken(token);
    return principal && assuranceSatisfies(principal.assurance, minimumAssurance) ? principal : null;
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
    return accessToken ? this.verifyAndSatisfy(accessToken, minimumAssurance) : null;
  }
}

export function readBearerToken(authorization: string | null): string | undefined {
  if (authorization === null) return undefined;
  const match = /^Bearer ([A-Za-z0-9_.-]{1,512})$/.exec(authorization);
  return match?.[1] ?? "";
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
