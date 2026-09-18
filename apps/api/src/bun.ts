import { config as loadDotenv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createApiApp } from "@api/app";
import { createSmtpEmailSenders } from "@api/smtp-email-senders";
import { authBackend } from "@api/modules/identity/server";
import { createPrismaClient } from "@api/shared/infrastructure/prisma-client";
import type { ApiBindings } from "@api/types";

const runtimeEnvironment = { ...process.env };
loadDotenv({
  path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env"),
  processEnv: runtimeEnvironment,
  quiet: true,
});
for (const key of [
  "DIRECT_URL",
  "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE",
  "POSTGRES_DB",
  "POSTGRES_USER",
  "POSTGRES_PASSWORD",
  "OIDC_CLIENT_SECRET",
]) {
  delete runtimeEnvironment[key];
}

type BunServer = Readonly<{ stop(force?: boolean): void }>;
declare const Bun: Readonly<{
  serve(options: { port: number; fetch(request: Request): Response | Promise<Response> }): BunServer;
}>;

const databaseUrl = runtimeEnvironment.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for the Bun API adapter.");
const database = createPrismaClient(databaseUrl);
const bindings: ApiBindings = {
  WEB_ORIGIN: runtimeEnvironment.WEB_ORIGIN,
  PROXY_SECRET: runtimeEnvironment.PROXY_SECRET ?? runtimeEnvironment.API_PROXY_SECRET,
  AUTH_BACKEND: runtimeEnvironment.AUTH_BACKEND,
  AUTH_APP_ORIGIN: runtimeEnvironment.AUTH_APP_ORIGIN,
  AUTH_MOBILE_REDIRECT_URL: runtimeEnvironment.AUTH_MOBILE_REDIRECT_URL,
  AUTH_MAGIC_LINK_SECRET: runtimeEnvironment.AUTH_MAGIC_LINK_SECRET,
  AUTH_SESSION_SECRET: runtimeEnvironment.AUTH_SESSION_SECRET,
  TURNSTILE_SECRET_KEY: runtimeEnvironment.TURNSTILE_SECRET_KEY,
  CRON_SECRET: runtimeEnvironment.CRON_SECRET,
  SMTP_HOST: runtimeEnvironment.SMTP_HOST,
  SMTP_PORT: runtimeEnvironment.SMTP_PORT,
  SMTP_SECURE: runtimeEnvironment.SMTP_SECURE,
  SMTP_REQUIRE_TLS: runtimeEnvironment.SMTP_REQUIRE_TLS,
  SMTP_USER: runtimeEnvironment.SMTP_USER,
  SMTP_PASSWORD: runtimeEnvironment.SMTP_PASSWORD,
  AUTH_EMAIL_FROM: runtimeEnvironment.AUTH_EMAIL_FROM,
  AUTH_EMAIL_FROM_NAME: runtimeEnvironment.AUTH_EMAIL_FROM_NAME,
  AUTH_MAGIC_LINK_TTL_SECONDS: runtimeEnvironment.AUTH_MAGIC_LINK_TTL_SECONDS,
  AUTH_ACCESS_TOKEN_TTL_SECONDS: runtimeEnvironment.AUTH_ACCESS_TOKEN_TTL_SECONDS,
  AUTH_REFRESH_TOKEN_TTL_SECONDS: runtimeEnvironment.AUTH_REFRESH_TOKEN_TTL_SECONDS,
  NODE_ENV: runtimeEnvironment.NODE_ENV,
  E2E_BROWSER_TESTS: runtimeEnvironment.E2E_BROWSER_TESTS,
  E2E_BROWSER_TEST_USERS: runtimeEnvironment.E2E_BROWSER_TEST_USERS,
  PASSKEY_RP_ID: runtimeEnvironment.PASSKEY_RP_ID,
  PASSKEY_ORIGIN: runtimeEnvironment.PASSKEY_ORIGIN,
  OIDC_ISSUER: runtimeEnvironment.OIDC_ISSUER,
  OIDC_CLIENT_ID: runtimeEnvironment.OIDC_CLIENT_ID,
  OIDC_AUDIENCE: runtimeEnvironment.OIDC_AUDIENCE,
  OIDC_SESSION_SECRET: runtimeEnvironment.OIDC_SESSION_SECRET,
  AUTH_ADMITTED_EMAILS: runtimeEnvironment.AUTH_ADMITTED_EMAILS,
  DATABASE_CLIENT: database,
};
const emailSenders = authBackend(bindings) === "passwordless" ? createSmtpEmailSenders(bindings) : undefined;
const app = createApiApp({ emailSenders });

const server = Bun.serve({
  port: Number(runtimeEnvironment.PORT ?? "8787"),
  fetch: (request) => app.fetch(request, bindings),
});

async function shutdown(): Promise<void> {
  server.stop(true);
  await database.$disconnect();
}

process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
