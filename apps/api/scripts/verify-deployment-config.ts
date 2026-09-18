import { loadWorkspaceEnvironment } from "./load-workspace-environment";
import { readAuthConfiguration } from "../src/modules/identity/infrastructure/auth-backend";
import { readSmtpEmailConfiguration } from "../src/smtp-email-senders";

loadWorkspaceEnvironment();
const production = process.env.NODE_ENV === "production" || process.env.VERIFY_DEPLOYMENT_PRODUCTION === "1";
const target = process.env.DEPLOYMENT_TARGET?.trim() || "bun";
const errors: string[] = [];
const checked: string[] = [];
const environment = { ...process.env, NODE_ENV: production ? "production" : process.env.NODE_ENV };

if (!(["bun", "node", "vercel"] as const).includes(target as "bun" | "node" | "vercel"))
  errors.push("DEPLOYMENT_TARGET must be bun, node, or vercel.");

validateOrigin("WEB_ORIGIN", true);
const proxySecret = process.env.PROXY_SECRET?.trim();
if (production && !proxySecret) errors.push("PROXY_SECRET is required.");
if (proxySecret && proxySecret.length < 32) errors.push("PROXY_SECRET must contain at least 32 characters.");
if (production && !process.env.CRON_SECRET?.trim())
  errors.push("CRON_SECRET is required for a production retention scheduler.");

validateUrl("DATABASE_URL", production);
validateOptionalUrl("DIRECT_URL");
if (production && sameEndpoint(process.env.DATABASE_URL, process.env.DIRECT_URL))
  errors.push("DATABASE_URL and DIRECT_URL must use separate endpoints in production.");
checked.push(`${target} PostgreSQL runtime configuration`);

const backend = process.env.AUTH_BACKEND?.trim() || "passwordless";
if (!(["none", "passwordless", "oidc"] as const).includes(backend as "none" | "passwordless" | "oidc")) {
  errors.push("AUTH_BACKEND must be none, passwordless, or oidc.");
} else if (backend === "passwordless") {
  try {
    const configuration = readAuthConfiguration(environment, { requireTurnstileSiteKey: false });
    if (configuration.backend !== "passwordless") throw new Error("Passwordless configuration is invalid.");
    checked.push("passwordless authentication configuration");
  } catch (error: unknown) {
    errors.push(error instanceof Error ? error.message : "Passwordless authentication configuration is invalid.");
  }
  requireValue("AUTH_EMAIL_FROM");
  requireValue("TURNSTILE_SECRET_KEY");
  try {
    readSmtpEmailConfiguration(environment);
    checked.push("standalone SMTP email delivery configuration");
  } catch (error: unknown) {
    errors.push(error instanceof Error ? error.message : "SMTP email delivery configuration is invalid.");
  }
} else if (backend === "oidc") {
  validateRequiredUrl("OIDC_ISSUER");
  requireValue("OIDC_CLIENT_ID");
  requireValue("OIDC_SESSION_SECRET");
  if ((process.env.OIDC_SESSION_SECRET?.trim().length ?? 0) < 32)
    errors.push("OIDC_SESSION_SECRET must contain at least 32 characters.");
  checked.push("OIDC API session verification configuration");
}

if (errors.length) {
  console.error(JSON.stringify({ valid: false, errors }));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ valid: true, production, target, backend, checked: checked.sort() }));
}

function requireValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  if (!value && production) errors.push(`${name} is required.`);
  return value;
}

function validateUrl(name: "DATABASE_URL" | "DIRECT_URL", required: boolean): void {
  const value = process.env[name]?.trim();
  if (!value && required) errors.push(`${name} is required.`);
  if (!value) return;
  try {
    const url = new URL(value);
    if (url.protocol !== "postgresql:" || !url.hostname) errors.push(`${name} must be a PostgreSQL URL.`);
  } catch {
    errors.push(`${name} must be a valid PostgreSQL URL.`);
  }
}

function validateOptionalUrl(name: "DIRECT_URL"): void {
  if (process.env[name]?.trim()) validateUrl(name, false);
}

function validateRequiredUrl(name: "OIDC_ISSUER"): void {
  const value = requireValue(name);
  if (!value) return;
  validateOrigin(name, false);
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

function sameEndpoint(first: string | undefined, second: string | undefined): boolean {
  if (!first || !second) return false;
  try {
    const left = new URL(first);
    const right = new URL(second);
    return left.hostname === right.hostname && (left.port || "5432") === (right.port || "5432");
  } catch {
    return false;
  }
}
