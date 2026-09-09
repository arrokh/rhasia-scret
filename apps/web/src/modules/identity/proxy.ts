import { readAuthConfiguration } from "./infrastructure/auth-backend";
import {
  createProxySessionVerifier,
  type ProxySessionVerifier,
  type SetAuthCookies,
} from "./infrastructure/proxy-session-verifier";
export type { SetAuthCookies };

export function createIdentityProxyVerifier(): ProxySessionVerifier {
  try {
    return createProxySessionVerifier(readAuthConfiguration());
  } catch {
    return createProxySessionVerifier({ backend: "none" });
  }
}
