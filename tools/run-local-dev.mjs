import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const repositoryRoot = resolve(import.meta.dirname, "..");
const environmentFile = resolve(repositoryRoot, ".env");
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const children = new Set();
const API_BLOCKED_ENVIRONMENT_KEYS = [
  "DIRECT_URL",
  "API_PROXY_SECRET",
  "POSTGRES_DB",
  "POSTGRES_USER",
  "POSTGRES_PASSWORD",
  "APP_PORT",
  "COMMIT_SHA",
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
  "APP_PORT",
  "COMMIT_SHA",
];
let stopping = false;
let complete;

loadEnvironment();
const webOrigin = readLocalOrigin("WEB_ORIGIN", "http://localhost:3000", 3000);
const apiOrigin = readLocalOrigin("API_ORIGIN", "http://localhost:8787", 8787);
const proxySecret = process.env.API_PROXY_SECRET?.trim() || process.env.PROXY_SECRET?.trim();
if (!proxySecret || proxySecret.length < 32) {
  throw new Error("API_PROXY_SECRET must contain at least 32 characters in .env.");
}

const apiEnvironment = createScopedEnvironment(
  {
    NODE_ENV: "development",
    PORT: portFor(apiOrigin, 8787),
    WEB_ORIGIN: webOrigin,
    PROXY_SECRET: proxySecret,
    AUTH_APP_ORIGIN: process.env.AUTH_APP_ORIGIN?.trim() || webOrigin,
    PASSKEY_ORIGIN: process.env.PASSKEY_ORIGIN?.trim() || webOrigin,
    PASSKEY_RP_ID: process.env.PASSKEY_RP_ID?.trim() || new URL(webOrigin).hostname,
  },
  API_BLOCKED_ENVIRONMENT_KEYS,
);

const webEnvironment = createScopedEnvironment(
  {
    NODE_ENV: "development",
    WEB_ORIGIN: webOrigin,
    API_ORIGIN: apiOrigin,
    API_PROXY_SECRET: proxySecret,
    AUTH_APP_ORIGIN: process.env.AUTH_APP_ORIGIN?.trim() || webOrigin,
    PASSKEY_ORIGIN: process.env.PASSKEY_ORIGIN?.trim() || webOrigin,
    PASSKEY_RP_ID: process.env.PASSKEY_RP_ID?.trim() || new URL(webOrigin).hostname,
  },
  WEB_BLOCKED_ENVIRONMENT_KEYS,
);

process.once("SIGINT", () => finish(130));
process.once("SIGTERM", () => finish(143));

try {
  await run();
} catch (error) {
  console.error(`[dev:local] ${error instanceof Error ? error.message : String(error)}`);
  finish(1);
}
await waitForChildrenToExit();

async function run() {
  const api = startChild("api", ["--dir", "apps/api", "run", "dev:bun"], apiEnvironment);
  await waitForApi(api, apiOrigin);

  if (stopping) return;
  console.log(`[dev:local] API ready at ${apiOrigin}; starting web at ${webOrigin}.`);
  const web = startChild(
    "web",
    ["--dir", "apps/web", "exec", "next", "dev", "-p", portFor(webOrigin, 3000)],
    webEnvironment,
  );

  await new Promise((resolveCompletion) => {
    complete = resolveCompletion;
    web.once("exit", (code, signal) => {
      if (stopping) return resolveCompletion();
      console.error(`[dev:local] web exited (${code ?? signal ?? "unknown"}).`);
      finish(code ?? 1);
      resolveCompletion();
    });
  });
}

function loadEnvironment() {
  try {
    process.loadEnvFile(environmentFile);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error("Missing .env. Copy .env.example to .env before running local development.");
    }
    throw error;
  }
}

function createScopedEnvironment(overrides, blockedKeys) {
  const environment = { ...process.env, ...overrides };
  for (const key of blockedKeys) delete environment[key];
  return environment;
}

function readLocalOrigin(name, fallback, defaultPort) {
  const value = process.env[name]?.trim() || fallback;
  let origin;
  try {
    origin = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid local origin.`);
  }
  if (
    origin.protocol !== "http:" ||
    !["localhost", "127.0.0.1"].includes(origin.hostname) ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    origin.username ||
    origin.password
  ) {
    throw new Error(`${name} must be an http://localhost or http://127.0.0.1 origin for local development.`);
  }
  if (!origin.port) origin.port = String(defaultPort);
  return origin.origin;
}

function portFor(origin, fallback) {
  const port = Number(new URL(origin).port || fallback);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`Invalid port in local origin: ${origin}`);
  return String(port);
}

function startChild(name, args, environment) {
  const child = spawn(pnpmCommand, args, {
    cwd: repositoryRoot,
    env: environment,
    stdio: "inherit",
    detached: process.platform !== "win32",
  });
  children.add(child);
  child.once("error", (error) => {
    if (!stopping) finish(1, `${name} failed to start: ${error.message}`);
  });
  child.once("exit", (code, signal) => {
    children.delete(child);
    if (stopping || name !== "api") return;
    finish(1, `${name} exited unexpectedly (${code ?? signal ?? "unknown"}).`);
    complete?.();
  });
  return child;
}

async function waitForApi(api, origin) {
  console.log(`[dev:local] waiting for API health at ${origin}/v1/health...`);
  const deadline = Date.now() + 120_000;
  while (!stopping && Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/v1/health`, { signal: AbortSignal.timeout(1_000) });
      await response.text();
      if (response.ok) return;
    } catch {
      // The API process may still be starting.
    }
    if (api.exitCode !== null || api.signalCode !== null) throw new Error("API exited before becoming ready.");
    await delay(250);
  }
  if (!stopping) throw new Error("Timed out waiting for the API to become ready.");
}

function finish(exitCode, message) {
  if (message) console.error(`[dev:local] ${message}`);
  if (stopping) return;
  stopping = true;
  process.exitCode = exitCode;
  terminateChildren();
  complete?.();
}

async function waitForChildrenToExit() {
  const activeChildren = [...children].filter((child) => child.exitCode === null && child.signalCode === null);
  if (activeChildren.length === 0) return;
  const exited = Promise.all(
    activeChildren.map(
      (child) =>
        new Promise((resolveChild) => {
          child.once("exit", resolveChild);
        }),
    ),
  );
  await Promise.race([exited, delay(5_000)]);
  if ([...children].some((child) => child.exitCode === null && child.signalCode === null)) {
    terminateChildren("SIGKILL");
  }
}

function terminateChildren(signal = "SIGTERM") {
  for (const child of children) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    if (process.platform !== "win32" && child.pid) {
      try {
        process.kill(-child.pid, signal);
        continue;
      } catch {
        // Fall back to the direct child when its process group has already exited.
      }
    }
    child.kill(signal);
  }
}
