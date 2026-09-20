import { config as loadDotenv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ApiBindings, ApiConfigBindings } from "@api/types";

export type ApiEnvironmentSource = Readonly<Record<string, string | undefined>>;

const API_BINDING_NAMES = [
  "WEB_ORIGIN",
  "PROXY_SECRET",
  "AUTH_BACKEND",
  "AUTH_APP_ORIGIN",
  "AUTH_MOBILE_REDIRECT_URL",
  "AUTH_MAGIC_LINK_SECRET",
  "AUTH_SESSION_SECRET",
  "TURNSTILE_SECRET_KEY",
  "CRON_SECRET",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_SECURE",
  "SMTP_REQUIRE_TLS",
  "SMTP_USER",
  "SMTP_PASSWORD",
  "AUTH_EMAIL_FROM",
  "AUTH_EMAIL_FROM_NAME",
  "AUTH_MAGIC_LINK_TTL_SECONDS",
  "AUTH_ACCESS_TOKEN_TTL_SECONDS",
  "AUTH_REFRESH_TOKEN_TTL_SECONDS",
  "NODE_ENV",
  "E2E_BROWSER_TESTS",
  "E2E_BROWSER_TEST_USERS",
  "PASSKEY_RP_ID",
  "PASSKEY_ORIGIN",
  "OIDC_ISSUER",
  "OIDC_CLIENT_ID",
  "OIDC_AUDIENCE",
  "OIDC_SESSION_SECRET",
  "AUTH_ADMITTED_EMAILS",
] as const satisfies readonly (keyof ApiBindings)[];

export function loadLocalApiEnvironment(source: NodeJS.ProcessEnv = process.env): Record<string, string | undefined> {
  const environment: Record<string, string | undefined> = { ...source };
  loadDotenv({
    path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env"),
    processEnv: environment,
    quiet: true,
  });
  return sanitizeApiRuntimeEnvironment(environment);
}

export function sanitizeApiRuntimeEnvironment(source: ApiEnvironmentSource): Record<string, string | undefined> {
  const environment = { ...source };
  for (const key of [
    "DIRECT_URL",
    "API_PROXY_SECRET",
    "POSTGRES_DB",
    "POSTGRES_USER",
    "POSTGRES_PASSWORD",
    "OIDC_CLIENT_SECRET",
  ]) {
    delete environment[key];
  }
  return environment;
}

export function readApiConfigBindings(source: ApiEnvironmentSource): ApiConfigBindings {
  const bindings: Record<string, string> = {};
  for (const name of API_BINDING_NAMES) {
    const value = source[name];
    if (value !== undefined) bindings[name] = value;
  }
  return bindings as ApiConfigBindings;
}

export function readRuntimeDatabaseUrl(source: ApiEnvironmentSource): string {
  const value = source.DATABASE_URL?.trim();
  if (!value) throw new Error("DATABASE_URL is required for the API runtime.");
  return value;
}
