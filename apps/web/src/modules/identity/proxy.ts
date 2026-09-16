import { readAuthConfiguration } from "./infrastructure/auth-backend";
import {
  createProxySessionVerifier,
  type ProxyAuthConfiguration,
  type ProxySessionVerifier,
  type SetAuthCookies,
} from "./infrastructure/proxy-session-verifier";
export type { SetAuthCookies };

export function createIdentityProxyVerifier(): ProxySessionVerifier {
  try {
    const backend = process.env.AUTH_BACKEND ?? "passwordless";
    if (backend === "none") return createProxySessionVerifier({ backend });
    if (backend === "passwordless") {
      const secret = process.env.AUTH_SESSION_SECRET?.trim();
      if (!secret || secret.length < 32) throw new Error("AUTH_SESSION_SECRET is not configured.");
      const configuration: ProxyAuthConfiguration = {
        backend,
        sessionSecret: new TextEncoder().encode(secret),
      };
      return createProxySessionVerifier(configuration);
    }
    if (backend === "oidc") {
      const configuration = readAuthConfiguration();
      if (configuration.backend !== "oidc") throw new Error("OIDC configuration is invalid.");
      return createProxySessionVerifier({ backend, ...configuration.oidc });
    }
    throw new Error("AUTH_BACKEND must be none, passwordless, or oidc.");
  } catch {
    return createProxySessionVerifier({ backend: "none" });
  }
}
