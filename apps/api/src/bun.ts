import { app } from "@api/app";
import { createPrismaClient } from "@api/shared/infrastructure/prisma-client";
import type { ApiBindings } from "@api/types";

type BunServer = Readonly<{ stop(force?: boolean): void }>;
declare const Bun: Readonly<{
  serve(options: { port: number; fetch(request: Request): Response | Promise<Response> }): BunServer;
}>;

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for the Bun API adapter.");
const database = createPrismaClient(databaseUrl);
const bindings: ApiBindings = {
  WEB_ORIGIN: process.env.WEB_ORIGIN,
  PROXY_SECRET: process.env.PROXY_SECRET,
  AUTH_BACKEND: process.env.AUTH_BACKEND,
  AUTH_APP_ORIGIN: process.env.AUTH_APP_ORIGIN,
  AUTH_MOBILE_REDIRECT_URL: process.env.AUTH_MOBILE_REDIRECT_URL,
  AUTH_MAGIC_LINK_SECRET: process.env.AUTH_MAGIC_LINK_SECRET,
  AUTH_SESSION_SECRET: process.env.AUTH_SESSION_SECRET,
  TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY,
  CRON_SECRET: process.env.CRON_SECRET,
  EMAIL_PROVIDER_URL: process.env.EMAIL_PROVIDER_URL,
  EMAIL_PROVIDER_TOKEN: process.env.EMAIL_PROVIDER_TOKEN,
  AUTH_EMAIL_FROM: process.env.AUTH_EMAIL_FROM,
  AUTH_EMAIL_FROM_NAME: process.env.AUTH_EMAIL_FROM_NAME,
  AUTH_MAGIC_LINK_TTL_SECONDS: process.env.AUTH_MAGIC_LINK_TTL_SECONDS,
  AUTH_ACCESS_TOKEN_TTL_SECONDS: process.env.AUTH_ACCESS_TOKEN_TTL_SECONDS,
  AUTH_REFRESH_TOKEN_TTL_SECONDS: process.env.AUTH_REFRESH_TOKEN_TTL_SECONDS,
  NODE_ENV: process.env.NODE_ENV,
  E2E_BROWSER_TESTS: process.env.E2E_BROWSER_TESTS,
  E2E_BROWSER_TEST_USERS: process.env.E2E_BROWSER_TEST_USERS,
  PASSKEY_RP_ID: process.env.PASSKEY_RP_ID,
  PASSKEY_ORIGIN: process.env.PASSKEY_ORIGIN,
  OIDC_ISSUER: process.env.OIDC_ISSUER,
  OIDC_CLIENT_ID: process.env.OIDC_CLIENT_ID,
  OIDC_AUDIENCE: process.env.OIDC_AUDIENCE,
  OIDC_SESSION_SECRET: process.env.OIDC_SESSION_SECRET,
  AUTH_ADMITTED_EMAILS: process.env.AUTH_ADMITTED_EMAILS,
  DATABASE_CLIENT: database,
};

const server = Bun.serve({
  port: Number(process.env.PORT ?? "8787"),
  fetch: (request) => app.fetch(request, bindings),
});

async function shutdown(): Promise<void> {
  server.stop(true);
  await database.$disconnect();
}

process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
