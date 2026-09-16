import { loadWorkspaceEnvironment } from "./load-workspace-environment";
import { readAuthConfiguration } from "../src/modules/identity/infrastructure/auth-backend";

loadWorkspaceEnvironment();

const production = process.env.NODE_ENV === "production" || process.env.VERIFY_DEPLOYMENT_PRODUCTION === "1";
const errors: string[] = [];
const checked = new Set<string>();
const backend = process.env.AUTH_BACKEND?.trim() || "passwordless";

if (production && !process.env.AUTH_BACKEND?.trim()) errors.push("AUTH_BACKEND must be set explicitly for production.");
if (!(["none", "passwordless", "oidc"] as const).includes(backend as "none" | "passwordless" | "oidc"))
  errors.push("AUTH_BACKEND must be none, passwordless, or oidc.");

validateOrigin("API_ORIGIN", true);
const proxySecret = requireValue("API_PROXY_SECRET");
if (proxySecret && proxySecret.length < 32) errors.push("API_PROXY_SECRET must contain at least 32 characters.");

if (backend === "passwordless") {
  requireValue("AUTH_SESSION_SECRET");
  if ((process.env.AUTH_SESSION_SECRET?.trim().length ?? 0) < 32)
    errors.push("AUTH_SESSION_SECRET must contain at least 32 characters.");
  if (production) requireValue("NEXT_PUBLIC_TURNSTILE_SITE_KEY");
  try {
    const configuration = readAuthConfiguration({
      ...process.env,
      NODE_ENV: production ? "production" : process.env.NODE_ENV,
      AUTH_BACKEND: "passwordless",
    });
    if (configuration.backend !== "passwordless") throw new Error("Passwordless configuration is invalid.");
    checked.add("Passwordless web origin configuration");
  } catch (error: unknown) {
    errors.push(error instanceof Error ? error.message : "Passwordless configuration is invalid.");
  }
  checked.add("Passwordless browser session verification");
}
if (backend === "oidc") {
  try {
    const configuration = readAuthConfiguration({
      ...process.env,
      NODE_ENV: production ? "production" : process.env.NODE_ENV,
    });
    if (configuration.backend !== "oidc") throw new Error("OIDC configuration is invalid.");
    checked.add("OIDC configuration");
  } catch (error: unknown) {
    errors.push(error instanceof Error ? error.message : "OIDC configuration is invalid.");
  }
}

validateOptionalPair("NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN", "NEXT_PUBLIC_POSTHOG_HOST");
if (process.env.NEXT_PUBLIC_POSTHOG_HOST?.trim()) validateOrigin("NEXT_PUBLIC_POSTHOG_HOST", false);

const passkeyRpId = process.env.PASSKEY_RP_ID?.trim();
const passkeyOrigin = process.env.PASSKEY_ORIGIN?.trim();
if (passkeyRpId || passkeyOrigin) {
  requireValue("PASSKEY_RP_ID");
  validateOrigin("PASSKEY_ORIGIN", true);
  if (passkeyOrigin) {
    try {
      const origin = new URL(passkeyOrigin);
      if (passkeyRpId && origin.hostname !== passkeyRpId)
        errors.push("PASSKEY_RP_ID must match PASSKEY_ORIGIN hostname.");
    } catch {
      // validateOrigin reports malformed values.
    }
  }
}

if (errors.length > 0) {
  console.error(JSON.stringify({ valid: false, errors }));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ valid: true, backend, production, checked: [...checked].sort() }));
}

function requireValue(name: string): string | undefined {
  checked.add(name);
  const value = process.env[name]?.trim();
  if (!value) errors.push(`${name} is required.`);
  return value;
}

function validateOrigin(name: string, originOnly: boolean): void {
  const value = requireValue(name);
  if (!value) return;
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" &&
      !(parsed.protocol === "http:" && !production && ["localhost", "127.0.0.1"].includes(parsed.hostname))
    )
      errors.push(`${name} must use HTTPS${production ? " in production" : ""}.`);
    if (parsed.username || parsed.password) errors.push(`${name} must not contain credentials.`);
    if (originOnly && (parsed.pathname !== "/" || parsed.search || parsed.hash))
      errors.push(`${name} must contain only an origin.`);
  } catch {
    errors.push(`${name} must be a valid URL.`);
  }
}

function validateOptionalPair(first: string, second: string): void {
  const firstSet = Boolean(process.env[first]?.trim());
  const secondSet = Boolean(process.env[second]?.trim());
  if (firstSet !== secondSet) errors.push(`${first} and ${second} must be set together or both omitted.`);
  if (firstSet) checked.add(first);
  if (secondSet) checked.add(second);
}
