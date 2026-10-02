import { assertDockerContextMatches, isPostgresReady, runCompose } from "./docker.mjs";
import { cleanHostEnvironment } from "./environment.mjs";
import { LoadTestError, assertNotAborted } from "./errors.mjs";
import { MAILPIT_ORIGIN, ROOT, WEB_ORIGIN } from "./settings.mjs";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

export async function waitForBootstrapServices(project, state, tunnel, signal) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    assertNotAborted(signal);
    assertRunnerTunnelAlive(tunnel);
    if ((await isHealthy(`${MAILPIT_ORIGIN}/`)) && isPostgresReady(project, state)) return;
    await delay(1_000);
  }
  throw new LoadTestError("The run-owned database or local SMTP capture service did not become healthy.");
}

export async function waitForServices(project, state, tunnel, signal) {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    assertNotAborted(signal);
    assertRunnerTunnelAlive(tunnel);
    const webReady = await isHealthy(`${WEB_ORIGIN}/api/v1/health`, true);
    const mailReady = await isHealthy(MAILPIT_ORIGIN + "/");
    const services = runCompose(project, state, ["ps", "--status", "running", "--services"], { capture: true })
      .split(/\r?\n/)
      .filter(Boolean);
    if (
      webReady &&
      mailReady &&
      ["db", "mailpit", "api", "web", "retention-purge"].every((name) => services.includes(name))
    )
      return;
    await delay(2_000);
  }
  throw new LoadTestError("The run-owned web, API, database, scheduler, or SMTP catcher did not become healthy.");
}

export async function startRunnerTunnel(state, signal) {
  assertNotAborted(signal);
  const context = assertDockerContextMatches(state);
  if (state.runnerPlacement === "same-machine") return null;
  const destination = `${context.username ? `${context.username}@` : ""}${context.hostname}`;
  const args = [
    "-N",
    "-T",
    "-o",
    "BatchMode=yes",
    "-o",
    "ExitOnForwardFailure=yes",
    "-o",
    "StrictHostKeyChecking=yes",
    "-o",
    "ServerAliveInterval=30",
    "-o",
    "ServerAliveCountMax=3",
  ];
  if (context.port) args.push("-p", context.port);
  args.push("-L", "127.0.0.1:4000:127.0.0.1:4000", "-L", "127.0.0.1:8025:127.0.0.1:8025", destination);
  const environment = cleanHostEnvironment();
  if (process.env.SSH_AUTH_SOCK) environment.SSH_AUTH_SOCK = process.env.SSH_AUTH_SOCK;
  const child = spawn("ssh", args, { cwd: ROOT, env: environment, stdio: "ignore" });
  let spawnError = false;
  const tunnel = { child };
  const onAbort = () => stopRunnerTunnel(tunnel);
  signal.addEventListener("abort", onAbort, { once: true });
  child.once("close", () => signal.removeEventListener("abort", onAbort));
  child.once("error", () => {
    spawnError = true;
  });
  await delay(300);
  assertNotAborted(signal);
  if (spawnError || child.exitCode !== null || child.signalCode !== null)
    throw new LoadTestError("The authenticated run-local service tunnel could not be established.");
  return { child };
}

function assertRunnerTunnelAlive(tunnel) {
  if (tunnel && (tunnel.child.exitCode !== null || tunnel.child.signalCode !== null))
    throw new LoadTestError("The authenticated run-local service tunnel closed during the run.");
}

export function stopRunnerTunnel(tunnel) {
  if (tunnel && tunnel.child.exitCode === null && tunnel.child.signalCode === null) tunnel.child.kill("SIGTERM");
}

export async function waitForTargetHealth(tunnel, signal) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    assertNotAborted(signal);
    assertRunnerTunnelAlive(tunnel);
    if (await isHealthy(`${WEB_ORIGIN}/api/v1/health`, true)) return;
    await delay(1_000);
  }
  throw new LoadTestError("The run-owned web health check failed before the scenario started.");
}

export async function isHealthy(url, sameOrigin = false) {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(2_000),
      redirect: "manual",
      ...(sameOrigin ? { headers: { origin: WEB_ORIGIN } } : {}),
    });
    return response.status >= 200 && response.status < 300;
  } catch {
    return false;
  }
}
