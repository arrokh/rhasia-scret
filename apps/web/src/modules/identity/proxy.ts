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
    const authConfiguration = readAuthConfiguration();
    if (authConfiguration.backend === "none") return createProxySessionVerifier(authConfiguration);
    if (authConfiguration.backend === "passwordless") {
      const secret = process.env.AUTH_SESSION_SECRET?.trim();
      if (!secret || secret.length < 32) throw new Error("AUTH_SESSION_SECRET is not configured.");
      const configuration: ProxyAuthConfiguration = {
        backend: authConfiguration.backend,
        sessionSecret: new TextEncoder().encode(secret),
      };
      return createProxySessionVerifier(configuration);
    }
    return createProxySessionVerifier({ backend: authConfiguration.backend, ...authConfiguration.oidc });
  } catch {
    return async () => "configuration_error";
  }
}
