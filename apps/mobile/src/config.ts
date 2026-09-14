import Constants from "expo-constants";
import { readPublicWebOrigin } from "./public-web-origin";

export type MobileClientConfiguration = {
  apiUrl: string;
  webOrigin: string;
  authRedirectUrl: string;
};

type PublicConfiguration = Partial<MobileClientConfiguration>;

export function parseMobileClientConfiguration(values: PublicConfiguration): MobileClientConfiguration {
  const apiUrl = requiredUrl(values.apiUrl, "EXPO_PUBLIC_API_URL", ["https:"]);
  const webOrigin = readPublicWebOrigin(values.webOrigin);
  const authRedirectUrl = requiredUrl(values.authRedirectUrl, "EXPO_PUBLIC_AUTH_REDIRECT_URL", [
    "https:",
    "rhasia-scret:",
  ]);
  const approvedCallback =
    authRedirectUrl.protocol === "rhasia-scret:"
      ? authRedirectUrl.hostname === "auth" && authRedirectUrl.port === "" && authRedirectUrl.pathname === "/magic-link"
      : authRedirectUrl.origin === webOrigin && authRedirectUrl.pathname === "/auth/mobile";
  if (
    !approvedCallback ||
    authRedirectUrl.username ||
    authRedirectUrl.password ||
    authRedirectUrl.search ||
    authRedirectUrl.hash
  )
    throw new Error("EXPO_PUBLIC_AUTH_REDIRECT_URL is not an approved callback.");
  if (apiUrl.username || apiUrl.password || apiUrl.pathname !== "/" || apiUrl.search || apiUrl.hash)
    throw new Error("Public service URLs must contain only an origin and no credentials.");
  return {
    apiUrl: apiUrl.origin,
    webOrigin,
    authRedirectUrl: authRedirectUrl.toString(),
  };
}

export function nativeCryptoValidationEnabled(): boolean {
  const extra = Constants.expoConfig?.extra as Record<string, unknown> | undefined;
  return extra?.nativeCryptoValidation === true;
}

export function readMobileClientConfiguration(): MobileClientConfiguration {
  const extra = Constants.expoConfig?.extra as PublicConfiguration | undefined;
  return parseMobileClientConfiguration(extra ?? {});
}

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is required.`);
  return normalized;
}

function requiredUrl(value: string | undefined, name: string, protocols: readonly string[]): URL {
  const parsed = new URL(required(value, name));
  if (!protocols.includes(parsed.protocol)) throw new Error(`${name} uses an unsupported protocol.`);
  return parsed;
}
