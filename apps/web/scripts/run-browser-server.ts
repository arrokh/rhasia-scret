import { spawn, type ChildProcess } from "node:child_process";

const webPort = process.argv[2] ?? process.env.BROWSER_TEST_PORT ?? "3100";
const apiPort = process.env.BROWSER_API_PORT ?? String(Number(webPort) + 5687);
const webOrigin = `http://127.0.0.1:${webPort}`;
const apiOrigin = `http://127.0.0.1:${apiPort}`;
const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const proxySecret = process.env.API_PROXY_SECRET ?? "browser-test-proxy-secret-12345678901234567890";
const children = new Set<ChildProcess>();
let stopping = false;

async function main(): Promise<void> {
  const api = spawn(command, ["--dir", "../api", "run", "dev:bun"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: apiPort,
      NODE_ENV: "development",
      WEB_ORIGIN: webOrigin,
      PROXY_SECRET: proxySecret,
      API_PROXY_SECRET: proxySecret,
      API_ORIGIN: apiOrigin,
      AUTH_APP_ORIGIN: webOrigin,
      PASSKEY_ORIGIN: webOrigin,
      PASSKEY_RP_ID: new URL(webOrigin).hostname,
      EMAIL_PROVIDER_URL: process.env.EMAIL_PROVIDER_URL?.trim() || "http://127.0.0.1:9999",
      EMAIL_PROVIDER_TOKEN: process.env.EMAIL_PROVIDER_TOKEN?.trim() || "browser-test-email-provider-token",
      AUTH_EMAIL_FROM: process.env.AUTH_EMAIL_FROM?.trim() || "no-reply@browser-e2e.invalid",
      AUTH_EMAIL_FROM_NAME: process.env.AUTH_EMAIL_FROM_NAME?.trim() || "rhasia-scret",
    },
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
      env: {
        ...process.env,
        NODE_ENV: "development",
        WEB_ORIGIN: webOrigin,
        API_ORIGIN: apiOrigin,
        API_PROXY_SECRET: proxySecret,
        AUTH_APP_ORIGIN: webOrigin,
        PASSKEY_ORIGIN: webOrigin,
        PASSKEY_RP_ID: new URL(webOrigin).hostname,
      },
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
