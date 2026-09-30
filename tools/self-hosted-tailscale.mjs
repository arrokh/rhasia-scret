import { randomBytes } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fchmodSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isDnsName, parseEnvFile, SELF_HOSTED_PROJECT_NAME, validateSelfHostedEnvironment } from "./self-hosted.mjs";
import { parseCanonicalOrigin } from "./self-hosted-origin.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ownershipFile = ".tailscale-rhasia.json";
const exposureModes = {
  serve: { label: "Serve", public: false, otherMode: "funnel" },
  funnel: { label: "Funnel", public: true, otherMode: "serve" },
};
const supportedModes = new Set(Object.keys(exposureModes));

export async function runTailscaleSetup(mode, { root = repositoryRoot, confirmPublic = false } = {}) {
  if (!supportedModes.has(mode)) throw new Error("Choose `serve` or `funnel`.");
  const modeDetails = exposureModes[mode];
  if (modeDetails.public && !confirmPublic) {
    throw new Error(
      "Funnel is public and Rhasia sign-in is disabled. Re-run with `funnel --confirm-public` to confirm public access.",
    );
  }

  const context = loadSelfHostedEnvironment(root);
  validateRemoteExposure(context.values);
  ensureTailscaleVersion();
  const node = readTailscaleNode();
  const expectedOrigin = `https://${node.hostname}`;
  if (context.values.WEB_ORIGIN !== expectedOrigin) {
    throw new Error(`Set WEB_ORIGIN to ${expectedOrigin} before enabling Tailscale exposure.`);
  }
  const appPort = String(Number(context.values.APP_PORT?.trim() || "3000"));
  verifyDockerPublishedBinding(root, appPort);
  await verifyWebHealth(appPort);

  const ownershipPath = resolve(root, ownershipFile);
  if (existsSync(ownershipPath)) {
    throw new Error(
      "A Rhasia Tailscale ownership record already exists; run `pnpm selfhosted:tailscale status` or `off` first.",
    );
  }

  const currentServe = readServiceStatus("serve");
  const currentFunnel = readServiceStatus("funnel");
  if (occupiesHttpsPort(currentServe, 443) || occupiesHttpsPort(currentFunnel, 443)) {
    throw new Error(
      "Tailscale HTTPS port 443 already has a listener. Remove or move that listener before configuring Rhasia.",
    );
  }

  const target = `http://127.0.0.1:${appPort}`;
  const state = {
    schemaVersion: 1,
    owner: "rhasia-scret",
    mode,
    hostname: node.hostname,
    httpsPort: 443,
    target,
    tailscaleArgs: ["--bg", "--https=443", target],
  };
  writeOwnershipRecord(ownershipPath, state);

  try {
    runInteractiveTailscale([mode, ...state.tailscaleArgs]);
    const active = readServiceStatus(mode);
    if (!listenerMatches(active, state)) {
      throw new Error(
        "Tailscale did not report the expected Rhasia listener. Inspect Tailscale status before changing this node.",
      );
    }
  } catch (error) {
    const serveNow = tryReadServiceStatus("serve");
    const funnelNow = tryReadServiceStatus("funnel");
    if (
      serveNow &&
      funnelNow &&
      !occupiesHttpsPort(serveNow, state.httpsPort) &&
      !occupiesHttpsPort(funnelNow, state.httpsPort)
    ) {
      removeOwnershipRecord(ownershipPath);
    }
    throw error;
  }

  console.log(`${modeDetails.label} enabled at https://${node.hostname}`);
  console.log("Rhasia application sign-in is disabled; hosted Vault APIs remain unavailable.");
  if (modeDetails.public) {
    console.log("This URL is publicly reachable without Rhasia sign-in; only local browser features are available.");
    return;
  }
  console.log("Tailscale Serve access follows your tailnet policy; only local browser features are available.");
}

export function showTailscaleStatus({ root = repositoryRoot } = {}) {
  const statePath = resolve(root, ownershipFile);
  const state = readOwnershipRecord(statePath);
  if (!state) {
    console.log("No Rhasia Tailscale listener is recorded. Other Tailscale listeners are unchanged.");
    return;
  }
  const current = readServiceStatus(state.mode);
  if (!listenerMatches(current, state)) {
    throw new Error(
      "The recorded Rhasia listener does not match the current Tailscale configuration; no changes were made.",
    );
  }
  console.log(`${exposureModes[state.mode].label} is active at https://${state.hostname}`);
}

export function disableTailscaleExposure({ root = repositoryRoot } = {}) {
  const statePath = resolve(root, ownershipFile);
  const state = readOwnershipRecord(statePath);
  if (!state)
    throw new Error("No Rhasia Tailscale ownership record exists; refusing to change Tailscale configuration.");

  const current = readServiceStatus(state.mode);
  if (!listenerMatches(current, state)) {
    const otherMode = exposureModes[state.mode].otherMode;
    const other = readServiceStatus(otherMode);
    if (occupiesHttpsPort(current, state.httpsPort) || occupiesHttpsPort(other, state.httpsPort)) {
      throw new Error(
        "The current listener at the recorded port differs from Rhasia's record; refusing to disable it.",
      );
    }
    removeOwnershipRecord(statePath);
    console.log("The Rhasia listener was already inactive; removed its stale local ownership record.");
    return;
  }

  runInteractiveTailscale([state.mode, ...state.tailscaleArgs, "off"]);
  const remaining = readServiceStatus(state.mode);
  if (occupiesHttpsPort(remaining, state.httpsPort)) {
    throw new Error(
      "Tailscale still reports a listener on the recorded port; the ownership record was kept for review.",
    );
  }

  removeOwnershipRecord(statePath);
  console.log(
    "Disabled the recorded Rhasia Tailscale listener. Other Tailscale listeners and the PostgreSQL volume are unchanged.",
  );
}

async function main(command, arguments_, root = process.cwd()) {
  if (command === "--interactive" && arguments_.length === 0) {
    const interface_ = createInterface({ input: stdin, output: stdout });
    try {
      const selected = (await interface_.question("Choose exposure mode: serve or funnel: ")).trim().toLowerCase();
      if (selected === "funnel") {
        const confirmation = await interface_.question(
          "Funnel is public and Rhasia sign-in is disabled. Type PUBLIC to continue: ",
        );
        if (confirmation.trim() !== "PUBLIC")
          throw new Error("Funnel was not enabled because public access was not confirmed.");
        await runTailscaleSetup("funnel", { root, confirmPublic: true });
        return;
      }
      if (selected !== "serve") throw new Error("Choose `serve` or `funnel`.");
      await runTailscaleSetup("serve", { root });
    } finally {
      interface_.close();
    }
    return;
  }
  if (command === "serve" && arguments_.length === 0) return runTailscaleSetup("serve", { root });
  if (command === "funnel" && arguments_.length === 0) return runTailscaleSetup("funnel", { root });
  if (command === "funnel" && arguments_.length === 1 && arguments_[0] === "--confirm-public") {
    return runTailscaleSetup("funnel", { root, confirmPublic: true });
  }
  if (command === "status" && arguments_.length === 0) return showTailscaleStatus({ root });
  if (command === "off" && arguments_.length === 0) return disableTailscaleExposure({ root });
  throw new Error("Usage: pnpm selfhosted:tailscale --interactive | serve | funnel --confirm-public | status | off");
}

function loadSelfHostedEnvironment(root) {
  const envPath = resolve(root, ".env");
  if (!existsSync(envPath)) throw new Error("Missing .env. Configure self-hosting before enabling Tailscale.");
  const values = parseEnvFile(readFileSync(envPath, "utf8"));
  const errors = validateSelfHostedEnvironment(values);
  if (errors.length > 0)
    throw new Error(`Self-hosted environment is invalid:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  return { values };
}

function validateRemoteExposure(values) {
  const errors = [];
  if (values.AUTH_BACKEND?.trim() !== "none") errors.push("AUTH_BACKEND must be none for Tailscale exposure.");
  if (!isHttpsOrigin(values.WEB_ORIGIN)) errors.push("WEB_ORIGIN must be an HTTPS origin.");
  if (values.APP_BIND_ADDRESS?.trim() !== "127.0.0.1" && values.APP_BIND_ADDRESS?.trim()) {
    errors.push("APP_BIND_ADDRESS must be 127.0.0.1 for Tailscale exposure.");
  }
  if (values.AUTH_TRUST_PROXY_HEADERS?.trim() !== "false")
    errors.push("AUTH_TRUST_PROXY_HEADERS must be explicitly set to false for this Tailscale setup.");

  for (const name of ["PROXY_SECRET", "API_PROXY_SECRET", "CRON_SECRET"]) {
    if ((values[name]?.trim().length ?? 0) < 32) errors.push(`${name} must contain at least 32 characters.`);
  }

  const appPort = values.APP_PORT?.trim();
  if (!appPort || !/^\d+$/u.test(appPort) || Number(appPort) < 1 || Number(appPort) > 65535) {
    errors.push("APP_PORT must be an integer from 1 to 65535.");
  }
  if (errors.length > 0)
    throw new Error(`Tailscale exposure checks failed:\n${errors.map((error) => `- ${error}`).join("\n")}`);
}

function ensureTailscaleVersion() {
  const result = runCapturedTailscale(["version"]);
  const match = result.match(/(?:^|\s)(\d+)\.(\d+)\.(\d+)(?=[-+\s]|$)/u);
  if (!match) throw new Error("Could not determine the Tailscale CLI version; version 1.52 or later is required.");
  const [, majorText, minorText] = match;
  const major = Number(majorText);
  const minor = Number(minorText);
  if (major < 1 || (major === 1 && minor < 52)) {
    throw new Error("Tailscale CLI 1.52 or later is required for the supported Serve/Funnel commands.");
  }
}

function readTailscaleNode() {
  const source = runCapturedTailscale(["status", "--json"]);
  let status;
  try {
    status = JSON.parse(source);
  } catch {
    throw new Error("Tailscale status was not valid JSON.");
  }
  const dnsName = status?.Self?.DNSName?.trim().replace(/\.$/u, "").toLowerCase();
  if (status?.BackendState !== "Running" || !dnsName || !isDnsName(dnsName)) {
    throw new Error("Tailscale must be connected on this host and report its MagicDNS hostname.");
  }
  return { hostname: dnsName };
}

function verifyDockerPublishedBinding(root, appPort) {
  const environment = { ...process.env, COMPOSE_PROJECT_NAME: SELF_HOSTED_PROJECT_NAME };
  const containers = spawnSync(
    "docker",
    [
      "ps",
      "--quiet",
      "--filter",
      `label=com.docker.compose.project=${SELF_HOSTED_PROJECT_NAME}`,
      "--filter",
      "label=com.docker.compose.service=web",
    ],
    { cwd: root, env: environment, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  if (containers.error || containers.status !== 0) {
    throw new Error("Unable to inspect the self-hosted Web container; verify Docker is running.");
  }
  const containerIds = containers.stdout.trim().split(/\s+/u).filter(Boolean);
  if (containerIds.length !== 1) {
    throw new Error("Exactly one running self-hosted Web container is required before enabling Tailscale exposure.");
  }
  const webContainerId = containerIds[0];

  const inspected = spawnSync("docker", ["inspect", "--format", "{{json .NetworkSettings.Ports}}", webContainerId], {
    cwd: root,
    env: environment,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (inspected.error || inspected.status !== 0) {
    throw new Error("Unable to inspect the self-hosted Web container port binding.");
  }

  try {
    const portMaps = inspected.stdout
      .trim()
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const mappings = portMaps.flatMap((ports) =>
      Object.entries(ports ?? {}).flatMap(([containerPort, bindings]) =>
        Array.isArray(bindings) ? bindings.map((binding) => ({ containerPort, ...binding })) : [],
      ),
    );
    if (
      portMaps.length !== 1 ||
      mappings.length !== 1 ||
      mappings[0].containerPort !== "3000/tcp" ||
      mappings[0].HostIp !== "127.0.0.1" ||
      mappings[0].HostPort !== appPort
    ) {
      throw new Error(
        "The self-hosted Web container must publish only 3000/tcp to 127.0.0.1 at the APP_PORT configured in .env.",
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("The self-hosted Web container")) throw error;
    throw new Error("Docker returned an invalid self-hosted Web port mapping.");
  }

  const webAuthentication = inspectDockerProjection(
    root,
    webContainerId,
    '{{range .Config.Env}}{{if eq . "AUTH_BACKEND=none"}}auth{{end}}{{if eq . "AUTH_TRUST_PROXY_HEADERS=false"}}proxy{{end}}{{end}}',
  );
  if (webAuthentication !== "authproxy") {
    throw new Error("The running Web container must use AUTH_BACKEND=none and disable proxy-header trust.");
  }

  const apiContainers = spawnSync(
    "docker",
    [
      "ps",
      "--quiet",
      "--filter",
      `label=com.docker.compose.project=${SELF_HOSTED_PROJECT_NAME}`,
      "--filter",
      "label=com.docker.compose.service=api",
    ],
    { cwd: root, env: environment, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  if (apiContainers.error || apiContainers.status !== 0) {
    throw new Error("Unable to inspect the self-hosted API container; verify Docker is running.");
  }
  const apiContainerIds = apiContainers.stdout.trim().split(/\s+/u).filter(Boolean);
  if (apiContainerIds.length !== 1) {
    throw new Error("Exactly one running self-hosted API container is required before enabling Tailscale exposure.");
  }
  const apiAuthentication = inspectDockerProjection(
    root,
    apiContainerIds[0],
    '{{range .Config.Env}}{{if eq . "AUTH_BACKEND=none"}}auth{{end}}{{end}}',
  );
  if (apiAuthentication !== "auth") {
    throw new Error("The running API container must use AUTH_BACKEND=none before Tailscale exposure.");
  }
}

function inspectDockerProjection(root, containerId, format) {
  const result = spawnSync("docker", ["inspect", "--format", format, containerId], {
    cwd: root,
    env: { ...process.env, COMPOSE_PROJECT_NAME: SELF_HOSTED_PROJECT_NAME },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) {
    throw new Error("Unable to inspect the running self-hosted application configuration.");
  }
  return result.stdout.trim();
}

async function verifyWebHealth(port) {
  let response;
  try {
    response = await fetch(`http://127.0.0.1:${port}/api/v1/health`, {
      signal: AbortSignal.timeout(3_000),
      redirect: "error",
    });
  } catch {
    throw new Error(
      "The self-hosted Web health endpoint is not reachable at the configured loopback port. Run `pnpm selfhosted:up` first.",
    );
  }
  if (!response.ok)
    throw new Error("The self-hosted Web health endpoint is not healthy. Run `pnpm selfhosted:up` first.");
}

function readServiceStatus(mode) {
  let source;
  try {
    source = runCapturedTailscale([mode, "status", "--json"]);
  } catch {
    throw new Error(`Unable to read Tailscale ${mode} status.`);
  }
  try {
    const status = JSON.parse(source);
    if (!status || typeof status !== "object" || Array.isArray(status)) throw new Error("Invalid status object.");
    return status;
  } catch {
    throw new Error(`Tailscale ${mode} status was not valid JSON.`);
  }
}

function tryReadServiceStatus(mode) {
  try {
    return readServiceStatus(mode);
  } catch {
    return undefined;
  }
}

function occupiesHttpsPort(status, port) {
  const web = collectWebListeners(status);
  if (web.some(([hostPort]) => portFromHostPort(hostPort) === port)) return true;
  return collectTcpListeners(status).some(([listenerPort]) => Number(listenerPort) === port);
}

function listenerMatches(status, state) {
  const webHandler = collectWebListeners(status).find(
    ([hostPort]) => hostPort === `${state.hostname}:${state.httpsPort}`,
  )?.[1];
  if (webHandler?.Handlers?.["/"]?.Proxy !== state.target) return false;
  const funnelEnabled = status.AllowFunnel?.[`${state.hostname}:${state.httpsPort}`] === true;
  return funnelEnabled === exposureModes[state.mode].public;
}

function collectWebListeners(status) {
  const listeners = [];
  function collect(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    for (const [key, item] of Object.entries(value)) {
      if (portFromHostPort(key) !== undefined) listeners.push([key, item]);
      else collect(item);
    }
  }
  collect(status.Web);
  if (Array.isArray(status.Foreground)) {
    for (const foreground of status.Foreground) collect(foreground?.Web);
  }
  return listeners;
}

function collectTcpListeners(status) {
  const listeners = [];
  function collect(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    for (const [key, item] of Object.entries(value)) {
      if (/^\d+$/u.test(key)) listeners.push([key, item]);
      else collect(item);
    }
  }
  collect(status.TCP);
  if (Array.isArray(status.Foreground)) {
    for (const foreground of status.Foreground) collect(foreground?.TCP);
  }
  return listeners;
}

function portFromHostPort(value) {
  const portText = value.slice(value.lastIndexOf(":") + 1);
  if (!/^\d+$/u.test(portText)) return undefined;
  return Number(portText);
}

function readOwnershipRecord(path) {
  let source;
  try {
    source = readFileSync(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw new Error("Unable to read the Rhasia Tailscale ownership record.");
  }
  let state;
  try {
    state = JSON.parse(source);
  } catch {
    throw new Error("The Rhasia Tailscale ownership record is invalid; refusing to change Tailscale configuration.");
  }
  if (
    state?.schemaVersion !== 1 ||
    state.owner !== "rhasia-scret" ||
    !supportedModes.has(state.mode) ||
    state.httpsPort !== 443 ||
    !isDnsName(state.hostname) ||
    typeof state.target !== "string" ||
    !/^http:\/\/127\.0\.0\.1:\d{1,5}$/u.test(state.target) ||
    !Array.isArray(state.tailscaleArgs) ||
    JSON.stringify(state.tailscaleArgs) !== JSON.stringify(["--bg", "--https=443", state.target])
  ) {
    throw new Error("The Rhasia Tailscale ownership record is invalid; refusing to change Tailscale configuration.");
  }
  return state;
}

function writeOwnershipRecord(path, state) {
  let descriptor;
  try {
    descriptor = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    fchmodSync(descriptor, 0o600);
    writeFileSync(descriptor, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8" });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      throw new Error("A Rhasia Tailscale ownership record already exists; inspect its status before continuing.");
    }
    throw new Error("Unable to write the local Rhasia Tailscale ownership record.");
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function removeOwnershipRecord(path) {
  try {
    unlinkSync(path);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      throw new Error("Unable to remove the local Rhasia Tailscale ownership record.");
    }
  }
}

function runCapturedTailscale(arguments_) {
  const result = spawnSync("tailscale", arguments_, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.error) throw new Error("Tailscale CLI is unavailable.");
  if (result.status !== 0) throw new Error("Tailscale command failed.");
  return result.stdout.trim();
}

function runInteractiveTailscale(arguments_) {
  const result = spawnSync("tailscale", arguments_, { stdio: "inherit" });
  if (result.error) throw new Error("Tailscale CLI is unavailable.");
  if (result.status !== 0) throw new Error("Tailscale command failed; review the Tailscale CLI output.");
}

function isHttpsOrigin(value) {
  const parsed = parseOrigin(value);
  return Boolean(parsed && parsed.protocol === "https:");
}

function parseOrigin(value) {
  const parsed = parseCanonicalOrigin(value);
  return parsed?.protocol === "https:" ? parsed : undefined;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    await main(process.argv[2], process.argv.slice(3));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Tailscale setup failed.");
    process.exitCode = 1;
  }
}
