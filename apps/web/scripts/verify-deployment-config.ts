import { loadWorkspaceEnvironment } from "./load-workspace-environment";
import { readAuthConfiguration } from "../src/modules/identity/infrastructure/auth-backend";

loadWorkspaceEnvironment();

const production = process.env.NODE_ENV === "production" || process.env.VERIFY_DEPLOYMENT_PRODUCTION === "1";
const errors: string[] = [];
const checked = new Set<string>();
const backend = process.env.AUTH_BACKEND?.trim() || "supabase";

if (production && !process.env.AUTH_BACKEND?.trim()) errors.push("AUTH_BACKEND must be set explicitly for a production deployment.");
if (!(["none", "supabase", "oidc"] as const).includes(backend as "none" | "supabase" | "oidc")) {
  errors.push("AUTH_BACKEND must be none, supabase, or oidc.");
}

validatePostgresUrl("DATABASE_URL", true);
validatePostgresUrl("DIRECT_URL", true);
if (production && sameEndpoint(process.env.DATABASE_URL, process.env.DIRECT_URL)) {
  errors.push("DATABASE_URL and DIRECT_URL must use separate host/port endpoints in production.");
}

if (backend === "supabase") {
  validateHttpsOrigin("NEXT_PUBLIC_SUPABASE_URL", true);
  requireValue("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
}

if (backend === "oidc") {
  try {
    readAuthConfiguration({ ...process.env, NODE_ENV: production ? "production" : process.env.NODE_ENV });
    checked.add("OIDC configuration");
  } catch (error: unknown) {
    errors.push(error instanceof Error ? error.message : "OIDC configuration is invalid.");
  }
  validateOptionalEmails();
}

validateOptionalPair("NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN", "NEXT_PUBLIC_POSTHOG_HOST");
if (process.env.NEXT_PUBLIC_POSTHOG_HOST?.trim()) validateHttpsOrigin("NEXT_PUBLIC_POSTHOG_HOST", false);

const passkeyRpId = process.env.PASSKEY_RP_ID?.trim();
const passkeyOrigin = process.env.PASSKEY_ORIGIN?.trim();
if (passkeyRpId || passkeyOrigin) {
  requireValue("PASSKEY_RP_ID");
  validateHttpsOrigin("PASSKEY_ORIGIN", false);
  if (passkeyOrigin) {
    try {
      const origin = new URL(passkeyOrigin);
      if (origin.pathname !== "/" || origin.search || origin.hash || origin.username || origin.password) {
        errors.push("PASSKEY_ORIGIN must contain only an origin.");
      }
      if (passkeyRpId && origin.hostname !== passkeyRpId) errors.push("PASSKEY_RP_ID must match the PASSKEY_ORIGIN hostname.");
    } catch {
      // validateHttpsOrigin has already reported the malformed value.
    }
  }
}

validateOptionalPattern("MOBILE_APPLE_TEAM_ID", /^[A-Z0-9]{10}$/, "must be a 10-character uppercase Apple Team ID");
validateOptionalPattern(
  "MOBILE_ANDROID_CERT_SHA256",
  /^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}(?:,\s*(?:[A-F0-9]{2}:){31}[A-F0-9]{2})*$/,
  "must contain one or more comma-separated uppercase colon-delimited SHA-256 fingerprints"
);

const cronSecret = process.env.CRON_SECRET?.trim();
if (production && !cronSecret) errors.push("CRON_SECRET is required for a production retention scheduler.");
if (cronSecret && cronSecret.length < 32) errors.push("CRON_SECRET must contain at least 32 characters.");
if (cronSecret) checked.add("CRON_SECRET");

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

function validatePostgresUrl(name: "DATABASE_URL" | "DIRECT_URL", required: boolean): void {
  const value = required ? requireValue(name) : process.env[name]?.trim();
  if (!value) return;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "postgresql:") errors.push(`${name} must use the postgresql: protocol.`);
    if (!parsed.hostname) errors.push(`${name} must include a database host.`);
  } catch {
    errors.push(`${name} must be a valid PostgreSQL connection URL.`);
  }
}

function validateHttpsOrigin(name: string, originOnly: boolean): void {
  const value = requireValue(name);
  if (!value) return;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && !production && ["localhost", "127.0.0.1"].includes(parsed.hostname))) {
      errors.push(`${name} must use HTTPS${production ? " in production" : ""}.`);
    }
    if (parsed.username || parsed.password) errors.push(`${name} must not contain credentials.`);
    if (originOnly && (parsed.pathname !== "/" || parsed.search || parsed.hash)) errors.push(`${name} must contain only an origin.`);
  } catch {
    errors.push(`${name} must be a valid URL.`);
  }
}

function validateOptionalEmails(): void {
  const value = process.env.AUTH_ADMITTED_EMAILS?.trim();
  if (!value) return;
  checked.add("AUTH_ADMITTED_EMAILS");
  const invalid = value.split(",").map((email) => email.trim()).some((email) => !/^[^@\s]+@[^@\s]+$/.test(email));
  if (invalid) errors.push("AUTH_ADMITTED_EMAILS must contain comma-separated email addresses.");
}

function validateOptionalPair(first: string, second: string): void {
  const firstSet = Boolean(process.env[first]?.trim());
  const secondSet = Boolean(process.env[second]?.trim());
  if (firstSet !== secondSet) errors.push(`${first} and ${second} must be set together or both omitted.`);
  if (firstSet) checked.add(first);
  if (secondSet) checked.add(second);
}

function validateOptionalPattern(name: string, pattern: RegExp, description: string): void {
  const value = process.env[name]?.trim();
  if (!value) return;
  checked.add(name);
  if (!pattern.test(value)) errors.push(`${name} ${description}.`);
}

function sameEndpoint(first: string | undefined, second: string | undefined): boolean {
  if (!first || !second) return false;
  try {
    const a = new URL(first);
    const b = new URL(second);
    return a.hostname === b.hostname && (a.port || defaultPort(a.protocol)) === (b.port || defaultPort(b.protocol));
  } catch {
    return false;
  }
}

function defaultPort(protocol: string): string {
  return protocol === "postgresql:" ? "5432" : "";
}
