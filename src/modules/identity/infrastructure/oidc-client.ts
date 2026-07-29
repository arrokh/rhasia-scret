import {
  ClientSecretBasic,
  authorizationCodeGrant,
  buildAuthorizationUrl,
  calculatePKCECodeChallenge,
  discovery,
  randomNonce,
  randomPKCECodeVerifier,
  randomState,
  type Configuration
} from "openid-client";
import type { OidcConfiguration } from "./auth-backend";
import type { VerifiedPrincipal } from "../application/session-verifier";

export async function createOidcAuthorizationRequest(configuration: OidcConfiguration): Promise<{ url: URL; state: string; nonce: string; verifier: string }> {
  const client = await discover(configuration);
  const state = randomState();
  const nonce = randomNonce();
  const verifier = randomPKCECodeVerifier();
  const challenge = await calculatePKCECodeChallenge(verifier);
  const url = buildAuthorizationUrl(client, {
    redirect_uri: configuration.redirectUri.href,
    scope: "openid email profile",
    response_type: "code",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    nonce,
    ...(configuration.audience ? { audience: configuration.audience } : {})
  });
  return { url, state, nonce, verifier };
}

export async function completeOidcAuthorization(
  configuration: OidcConfiguration,
  callbackUrl: URL,
  state: string,
  nonce: string,
  verifier: string
): Promise<{ principal: VerifiedPrincipal; expiresAt: number }> {
  if (callbackUrl.origin !== configuration.redirectUri.origin || callbackUrl.pathname !== configuration.redirectUri.pathname) throw new Error("OIDC redirect URI is invalid.");
  const client = await discover(configuration);
  const tokens = await authorizationCodeGrant(client, callbackUrl, {
    expectedState: state,
    expectedNonce: nonce,
    pkceCodeVerifier: verifier,
    idTokenExpected: true
  });
  const claims = tokens.claims();
  if (!claims || typeof claims.iss !== "string" || claims.iss.replace(/\/$/, "") !== configuration.issuer.href.replace(/\/$/, "")) throw new Error("OIDC issuer claim is invalid.");
  if (typeof claims.sub !== "string" || typeof claims.email !== "string" || claims.email_verified !== true) throw new Error("OIDC claims are not admitted.");
  const expiresIn = tokens.expiresIn();
  if (!expiresIn || expiresIn <= 0) throw new Error("OIDC token is expired.");
  return {
    principal: {
      issuer: claims.iss.replace(/\/$/, ""),
      subject: claims.sub,
      email: claims.email.toLowerCase(),
      emailVerified: true,
      assurance: "active-session",
      sessionId: typeof claims.sid === "string" ? claims.sid : undefined
    },
    expiresAt: Math.floor(Date.now() / 1000) + expiresIn
  };
}

async function discover(configuration: OidcConfiguration): Promise<Configuration> {
  return discovery(
    configuration.issuer,
    configuration.clientId,
    { client_secret: configuration.clientSecret, token_endpoint_auth_method: "client_secret_basic" },
    ClientSecretBasic(configuration.clientSecret)
  );
}
