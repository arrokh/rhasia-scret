import { cookies, headers } from "next/headers";
import type { PasswordlessAuthService } from "../application/passwordless-authentication";
import type { SessionAssurance, SessionVerifier, VerifiedPrincipal } from "../application/session-verifier";
import { assuranceSatisfies } from "../application/session-verifier";
import type { PasswordlessConfiguration } from "./auth-backend";
import { BROWSER_E2E_SESSION_COOKIE, browserE2eTestSession } from "./browser-e2e-test-session";
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

  public async verify(minimumAssurance: SessionAssurance = "fresh-provider-user"): Promise<VerifiedPrincipal | null> {
    const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
    const testSession = browserE2eTestSession(cookieStore.get(BROWSER_E2E_SESSION_COOKIE)?.value);
    if (testSession && assuranceSatisfies(testSession.assurance, minimumAssurance)) return testSession;

    const bearerToken = readBearerToken(headerStore.get("authorization"));
    if (bearerToken !== undefined) return this.verifyAndSatisfy(bearerToken, minimumAssurance);

    const assertion = cookieStore.get(PASSWORDLESS_ASSERTION_COOKIE)?.value;
    if (assertion) {
      const sessionId = await verifyPasswordlessBrowserAssertion(this.configuration, assertion);
      if (sessionId) {
        const principal = await this.service.verifyBrowserSession(sessionId);
        if (principal && assuranceSatisfies(principal.assurance, minimumAssurance)) return principal;
      }
      return null;
    }

    const accessToken = cookieStore.get(PASSWORDLESS_ACCESS_COOKIE)?.value;
    return accessToken ? this.verifyAndSatisfy(accessToken, minimumAssurance) : null;
  }

  private async verifyAndSatisfy(token: string, minimumAssurance: SessionAssurance): Promise<VerifiedPrincipal | null> {
    const principal = await this.service.verifyAccessToken(token);
    return principal && assuranceSatisfies(principal.assurance, minimumAssurance) ? principal : null;
  }
}

export function readBearerToken(authorization: string | null): string | undefined {
  if (authorization === null) return undefined;
  const match = /^Bearer ([A-Za-z0-9_.-]{1,512})$/.exec(authorization);
  return match?.[1] ?? "";
}
