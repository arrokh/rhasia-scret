import { jwtVerify } from "jose";
import type { SessionAssurance, SessionVerifier, VerifiedPrincipal } from "../application/session-verifier";
import { assuranceSatisfies } from "../application/session-verifier";

export const OIDC_SESSION_COOKIE = "rhsia-oidc-session";
export const OIDC_STATE_COOKIE = "rhsia-oidc-state";
export const OIDC_VERIFIER_COOKIE = "rhsia-oidc-pkce";
export const OIDC_NONCE_COOKIE = "rhsia-oidc-nonce";
export const OIDC_RETURN_PATH_COOKIE = "rhsia-oidc-return-path";

export type OidcVerificationConfiguration = Readonly<{
  issuer: URL;
  clientId: string;
  sessionSecret: Uint8Array;
}>;

export class OidcSessionVerifier implements SessionVerifier {
  public constructor(private readonly configuration: OidcVerificationConfiguration) {}

  public async verify(
    request: Request,
    minimumAssurance: SessionAssurance = "fresh-provider-user",
  ): Promise<VerifiedPrincipal | null> {
    const cookies = parseCookies(request.headers.get("cookie"));
    if (cookies.has(OIDC_SESSION_COOKIE) && !request.headers.has("x-rhasia-proxy-secret")) return null;
    const token = cookies.get(OIDC_SESSION_COOKIE);
    if (!token) return null;
    try {
      const { payload } = await jwtVerify(token, this.configuration.sessionSecret, {
        issuer: "rhasia:oidc-session",
        audience: this.configuration.clientId,
      });
      const principal = parsePrincipal(payload);
      const configuredIssuer = this.configuration.issuer.href.replace(/\/$/, "");
      return principal &&
        principal.issuer === configuredIssuer &&
        assuranceSatisfies(principal.assurance, minimumAssurance)
        ? principal
        : null;
    } catch {
      return null;
    }
  }
}

function parsePrincipal(payload: Record<string, unknown>): VerifiedPrincipal | null {
  const issuer = payload.provider_issuer;
  const subject = payload.subject;
  const email = payload.email;
  const emailVerified = payload.email_verified;
  const assurance = payload.assurance;
  if (typeof issuer !== "string" || typeof subject !== "string" || typeof email !== "string" || emailVerified !== true)
    return null;
  if (assurance !== "verified-claims" && assurance !== "fresh-provider-user" && assurance !== "active-session")
    return null;
  const providerIssuedAt = payload.provider_issued_at;
  const issuedAt = providerIssuedAt === undefined ? payload.iat : providerIssuedAt;
  if (typeof issuedAt !== "number" || !Number.isFinite(issuedAt)) return null;
  const issuedAtDate = new Date(providerIssuedAt === undefined ? issuedAt * 1_000 : issuedAt);
  if (!Number.isFinite(issuedAtDate.getTime())) return null;
  return {
    issuer,
    subject,
    email: email.toLowerCase(),
    emailVerified,
    assurance,
    sessionId: typeof payload.session_id === "string" ? payload.session_id : undefined,
    issuedAt: issuedAtDate,
  };
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
