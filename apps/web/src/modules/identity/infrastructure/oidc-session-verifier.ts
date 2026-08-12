import { cookies } from "next/headers";
import { jwtVerify } from "jose";
import type { SessionAssurance, SessionVerifier, VerifiedPrincipal } from "../application/session-verifier";
import { assuranceSatisfies } from "../application/session-verifier";
import type { OidcConfiguration } from "./auth-backend";
import { BROWSER_E2E_SESSION_COOKIE, browserE2eTestSession } from "./browser-e2e-test-session";

export const OIDC_SESSION_COOKIE = "rhsia-oidc-session";
export const OIDC_STATE_COOKIE = "rhsia-oidc-state";
export const OIDC_VERIFIER_COOKIE = "rhsia-oidc-pkce";
export const OIDC_NONCE_COOKIE = "rhsia-oidc-nonce";

export class OidcSessionVerifier implements SessionVerifier {
  public constructor(private readonly configuration: OidcConfiguration) {}

  public async verify(minimumAssurance: SessionAssurance = "fresh-provider-user"): Promise<VerifiedPrincipal | null> {
    const cookieStore = await cookies();
    const e2eSession = browserE2eTestSession(cookieStore.get(BROWSER_E2E_SESSION_COOKIE)?.value);
    if (e2eSession && assuranceSatisfies(e2eSession.assurance, minimumAssurance)) return e2eSession;
    const token = cookieStore.get(OIDC_SESSION_COOKIE)?.value;
    if (!token) return null;
    try {
      const { payload } = await jwtVerify(token, this.configuration.sessionSecret, {
        issuer: "rhasia:oidc-session",
        audience: this.configuration.clientId
      });
      const principal = parsePrincipal(payload);
      const configuredIssuer = this.configuration.issuer.href.replace(/\/$/, "");
      return principal && principal.issuer === configuredIssuer && assuranceSatisfies(principal.assurance, minimumAssurance) ? principal : null;
    } catch {
      return null;
    }
  }
}

export async function signOidcSession(configuration: OidcConfiguration, principal: VerifiedPrincipal, expiresAt: number): Promise<string> {
  const { SignJWT } = await import("jose");
  return new SignJWT({
    provider_issuer: principal.issuer,
    subject: principal.subject,
    email: principal.email,
    email_verified: principal.emailVerified,
    assurance: principal.assurance,
    session_id: principal.sessionId
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer("rhasia:oidc-session")
    .setAudience(configuration.clientId)
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(configuration.sessionSecret);
}

function parsePrincipal(payload: Record<string, unknown>): VerifiedPrincipal | null {
  const issuer = payload.provider_issuer;
  const subject = payload.subject;
  const email = payload.email;
  const emailVerified = payload.email_verified;
  const assurance = payload.assurance;
  if (typeof issuer !== "string" || typeof subject !== "string" || typeof email !== "string" || emailVerified !== true) return null;
  if (assurance !== "verified-claims" && assurance !== "fresh-provider-user" && assurance !== "active-session") return null;
  return {
    issuer,
    subject,
    email: email.toLowerCase(),
    emailVerified,
    assurance,
    sessionId: typeof payload.session_id === "string" ? payload.session_id : undefined
  };
}
