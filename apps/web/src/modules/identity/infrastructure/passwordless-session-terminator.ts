import { cookies } from "next/headers";
import type { SessionTerminator } from "../application/session-terminator";
import { createPasswordlessAuthServiceForServer, readPasswordlessConfiguration } from "./passwordless-service";
import type { PasswordlessAuthService } from "../application/passwordless-authentication";
import {
  clearPasswordlessSessionCookies,
  PASSWORDLESS_ACCESS_COOKIE,
  PASSWORDLESS_ASSERTION_COOKIE,
  verifyPasswordlessBrowserAssertion,
  type PasswordlessCookieStore,
} from "./passwordless-session";
import { BROWSER_E2E_SESSION_COOKIE, browserE2eTestSession } from "./browser-e2e-test-session";

export class PasswordlessSessionTerminator implements SessionTerminator {
  public constructor(
    private readonly service: PasswordlessAuthService = createService(),
    private readonly configuration = readPasswordlessConfiguration(),
  ) {}

  public async terminateCurrentSession(): Promise<void> {
    const cookieStore = await cookies();
    const testAlias = cookieStore.get(BROWSER_E2E_SESSION_COOKIE)?.value;
    if (testAlias && browserE2eTestSession(testAlias)) {
      clearPasswordlessSessionCookies(cookieStore);
      clearBrowserE2eSessionCookie(cookieStore);
      return;
    }

    const sessionId = await this.currentSessionId(cookieStore);
    if (sessionId) await this.service.revoke(sessionId);
    clearPasswordlessSessionCookies(cookieStore);
  }

  private async currentSessionId(cookieStore: PasswordlessCookieStore): Promise<string | null> {
    const assertion = cookieStore.get(PASSWORDLESS_ASSERTION_COOKIE)?.value;
    if (assertion) {
      const sessionId = await verifyPasswordlessBrowserAssertion(this.configuration, assertion);
      if (sessionId && (await this.service.verifyBrowserSession(sessionId))) return sessionId;
    }

    const accessToken = cookieStore.get(PASSWORDLESS_ACCESS_COOKIE)?.value;
    const principal = accessToken ? await this.service.verifyAccessToken(accessToken) : null;
    return principal?.sessionId ?? null;
  }
}

function createService(): PasswordlessAuthService {
  return createPasswordlessAuthServiceForServer();
}

function clearBrowserE2eSessionCookie(cookieStore: PasswordlessCookieStore): void {
  cookieStore.set(BROWSER_E2E_SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
}
