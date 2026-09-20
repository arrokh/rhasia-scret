import type { ResponseCookieStore } from "@api/http/cookies";
import type { SessionTerminator } from "../application/session-terminator";
import { OIDC_SESSION_COOKIE } from "./oidc-session-verifier";

export class OidcSessionTerminator implements SessionTerminator {
  public async terminateCurrentSession(_request: Request, cookies: ResponseCookieStore): Promise<void> {
    cookies.set(OIDC_SESSION_COOKIE, "", { httpOnly: true, secure: true, sameSite: "lax", maxAge: 0, path: "/" });
  }
}
