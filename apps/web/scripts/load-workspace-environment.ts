import { readFileSync } from "node:fs";
import { config as loadDotenv, parse as parseDotenv } from "dotenv";
import { resolve } from "node:path";

export const WEB_RUNTIME_ENVIRONMENT_KEYS = [
  "WEB_ORIGIN",
  "API_ORIGIN",
  "API_PROXY_SECRET",
  "AUTH_BACKEND",
  "AUTH_APP_ORIGIN",
  "AUTH_TRUST_PROXY_HEADERS",
  "AUTH_MOBILE_REDIRECT_URL",
  "AUTH_SESSION_SECRET",
  "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
  "NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN",
  "NEXT_PUBLIC_POSTHOG_HOST",
  "NEXT_PUBLIC_CLOUDFLARE_WEB_ANALYTICS_TOKEN",
  "OIDC_ISSUER",
  "OIDC_CLIENT_ID",
  "OIDC_CLIENT_SECRET",
  "OIDC_REDIRECT_URI",
  "OIDC_AUDIENCE",
  "OIDC_SESSION_SECRET",
  "PASSKEY_RP_ID",
  "PASSKEY_ORIGIN",
  "NEXT_ALLOWED_DEV_ORIGINS",
  "MOBILE_APPLE_TEAM_ID",
  "MOBILE_ANDROID_CERT_SHA256",
  "E2E_BROWSER_TESTS",
  "E2E_BROWSER_TEST_USERS",
  "NEXT_PUBLIC_E2E_BROWSER_TESTS",
] as const;

type WorkspaceEnvironmentOptions = Readonly<{
  allowedKeys?: readonly string[];
}>;

/** Load the repository-root environment contract for workspace scripts. */
export function loadWorkspaceEnvironment(options: WorkspaceEnvironmentOptions = {}): void {
  // Web package commands execute with apps/web as their working directory.
  const path = resolve(process.cwd(), "../../.env");
  if (!options.allowedKeys) {
    loadDotenv({ path });
    return;
  }

  let parsed: Record<string, string>;
  try {
    parsed = parseDotenv(readFileSync(path, "utf8"));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
  const allowedKeys = new Set(options.allowedKeys);
  for (const [key, value] of Object.entries(parsed)) {
    if (allowedKeys.has(key) && process.env[key] === undefined) process.env[key] = value;
  }
}
