import { spawn, type ChildProcess } from "node:child_process";

const webPort = process.argv[2] ?? process.env.BROWSER_TEST_PORT ?? "3100";
const apiPort = process.env.BROWSER_API_PORT ?? String(Number(webPort) + 5687);
const webOrigin = `http://127.0.0.1:${webPort}`;
const apiOrigin = `http://127.0.0.1:${apiPort}`;
const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const proxySecret = process.env.API_PROXY_SECRET ?? "browser-test-proxy-secret-12345678901234567890";
const API_BLOCKED_ENVIRONMENT_KEYS = [
  "DIRECT_URL",
  "API_PROXY_SECRET",
  "POSTGRES_DB",
  "POSTGRES_USER",
  "POSTGRES_PASSWORD",
  "OIDC_CLIENT_SECRET",
];
const WEB_BLOCKED_ENVIRONMENT_KEYS = [
  "DATABASE_URL",
  "DIRECT_URL",
  "POSTGRES_DB",
  "POSTGRES_USER",
  "POSTGRES_PASSWORD",
  "TURNSTILE_SECRET_KEY",
  "AUTH_MAGIC_LINK_SECRET",
  "AUTH_MAGIC_LINK_TTL_SECONDS",
  "AUTH_ACCESS_TOKEN_TTL_SECONDS",
  "AUTH_REFRESH_TOKEN_TTL_SECONDS",
  "AUTH_ADMITTED_EMAILS",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_SECURE",
  "SMTP_REQUIRE_TLS",
  "SMTP_USER",
  "SMTP_PASSWORD",
  "AUTH_EMAIL_FROM",
  "AUTH_EMAIL_FROM_NAME",
  "CRON_SECRET",
  "PROXY_SECRET",
];
const children = new Set<ChildProcess>();
let stopping = false;

async function main(): Promise<void> {
  const api = spawn(command, ["--dir", "../api", "run", "dev:bun"], {
    cwd: process.cwd(),
    env: createScopedEnvironment(
      {
        PORT: apiPort,
        NODE_ENV: "development",
        WEB_ORIGIN: webOrigin,
        PROXY_SECRET: proxySecret,
        API_ORIGIN: apiOrigin,
        AUTH_APP_ORIGIN: webOrigin,
        PASSKEY_ORIGIN: webOrigin,
        PASSKEY_RP_ID: new URL(webOrigin).hostname,
        SMTP_HOST: "127.0.0.1",
        SMTP_PORT: "2525",
        SMTP_SECURE: "false",
        SMTP_REQUIRE_TLS: "true",
        SMTP_USER: "browser-test-smtp-user",
        SMTP_PASSWORD: "browser-test-smtp-password",
        AUTH_EMAIL_FROM: process.env.AUTH_EMAIL_FROM?.trim() || "no-reply@browser-e2e.invalid",
        AUTH_EMAIL_FROM_NAME: process.env.AUTH_EMAIL_FROM_NAME?.trim() || "rhasia-scret",
      },
      API_BLOCKED_ENVIRONMENT_KEYS,
    ),
    stdio: "inherit",
  });
  children.add(api);

  api.once("error", (error) => fail(`API server failed to start: ${error.message}`));
  api.once("exit", (code, signal) => {
    children.delete(api);
    if (!stopping) fail(`API server exited (${code ?? signal ?? "unknown"}).`);
  });

  try {
    await waitForApi(apiOrigin);
    const web = spawn(command, ["exec", "next", "dev", "-p", webPort], {
      cwd: process.cwd(),
      env: createScopedEnvironment(
        {
          NODE_ENV: "development",
          WEB_ORIGIN: webOrigin,
          API_ORIGIN: apiOrigin,
          API_PROXY_SECRET: proxySecret,
          AUTH_APP_ORIGIN: webOrigin,
          PASSKEY_ORIGIN: webOrigin,
          PASSKEY_RP_ID: new URL(webOrigin).hostname,
        },
        WEB_BLOCKED_ENVIRONMENT_KEYS,
      ),
      stdio: "inherit",
    });
    children.add(web);
    web.once("error", (error) => fail(`Web server failed to start: ${error.message}`));
    web.once("exit", (code, signal) => {
      children.delete(web);
      stopChildren();
      process.exitCode = code ?? (signal ? 1 : 0);
    });
    await new Promise<void>(() => undefined);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

void main();
async function waitForApi(origin: string): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/v1/health`);
      if (response.ok) return;
    } catch {
      // The API process may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Timed out waiting for the API browser-test server.");
}

function createScopedEnvironment(overrides: NodeJS.ProcessEnv, blockedKeys: readonly string[]): NodeJS.ProcessEnv {
  const environment = { ...process.env, ...overrides };
  for (const key of blockedKeys) delete environment[key];
  return environment;
}

function fail(message: string): void {
  if (stopping) return;
  console.error(message);
  stopping = true;
  stopChildren();
  process.exitCode = 1;
}

function stopChildren(): void {
  for (const child of children) child.kill("SIGTERM");
}

process.once("SIGINT", () => {
  stopping = true;
  stopChildren();
  process.exitCode = 130;
});
process.once("SIGTERM", () => {
  stopping = true;
  stopChildren();
  process.exitCode = 143;
});
