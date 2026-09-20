import type { ResponseCookieStore } from "@api/http/cookies";
import type { PasswordlessAuthService } from "../application/passwordless-authentication";
import type { SessionTerminator } from "../application/session-terminator";
import {
  clearPasswordlessSessionCookies,
  PASSWORDLESS_ACCESS_COOKIE,
  PASSWORDLESS_ASSERTION_COOKIE,
  PASSWORDLESS_REFRESH_COOKIE,
} from "./passwordless-session";

export class PasswordlessSessionTerminator implements SessionTerminator {
  public constructor(private readonly service: PasswordlessAuthService) {}

  public async terminateCurrentSession(request: Request, cookies: ResponseCookieStore): Promise<void> {
    const bearerToken = readBearerToken(request.headers.get("authorization"));
    if (bearerToken) {
      const principal = await this.service.verifyAccessToken(bearerToken);
      if (principal?.sessionId) await this.service.revoke(principal.sessionId);
    } else {
      const values = parseCookies(request.headers.get("cookie"));
      const refreshToken = values.get(PASSWORDLESS_REFRESH_COOKIE);
      if (refreshToken) {
        const sessionId = refreshToken.split(".", 1)[0];
        if (sessionId) await this.service.revoke(sessionId);
      }
      const accessToken = values.get(PASSWORDLESS_ACCESS_COOKIE);
      if (accessToken && !refreshToken) {
        const principal = await this.service.verifyAccessToken(accessToken);
        if (principal?.sessionId) await this.service.revoke(principal.sessionId);
      }
    }
    clearPasswordlessSessionCookies(cookies);
    cookies.set(PASSWORDLESS_ASSERTION_COOKIE, "", {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 0,
      path: "/",
    });
  }
}

function readBearerToken(value: string | null): string | null {
  const match = value ? /^Bearer ([A-Za-z0-9_.-]{1,512})$/.exec(value) : null;
  return match?.[1] ?? null;
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
