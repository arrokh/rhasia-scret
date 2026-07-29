import { cookies } from "next/headers";
import type { SessionTerminator } from "../application/session-terminator";
import { BROWSER_E2E_SESSION_COOKIE } from "./browser-e2e-test-session";
import { OIDC_NONCE_COOKIE, OIDC_SESSION_COOKIE, OIDC_STATE_COOKIE, OIDC_VERIFIER_COOKIE } from "./oidc-session-verifier";

export class OidcSessionTerminator implements SessionTerminator {
  public async terminateCurrentSession(): Promise<void> {
    const cookieStore = await cookies();
    for (const name of [OIDC_SESSION_COOKIE, OIDC_STATE_COOKIE, OIDC_NONCE_COOKIE, OIDC_VERIFIER_COOKIE, BROWSER_E2E_SESSION_COOKIE]) {
      cookieStore.set(name, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 0, path: "/" });
    }
  }
}
