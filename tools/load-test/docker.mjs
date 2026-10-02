import { cleanHostEnvironment, loadTestResourceProfileEnvironment, safeComposeEnvironment } from "./environment.mjs";
import { LoadTestError } from "./errors.mjs";
import { COMPOSE_FILES, DATABASE_NAME, DISPOSABLE_DATABASE_OPERATIONS, PROJECT_PREFIX, ROOT } from "./settings.mjs";
import { envFilePath } from "./state.mjs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

export function inspectDockerContext(requestedName) {
  const nameResult = requestedName
    ? { status: 0, stdout: requestedName }
    : spawnSync("docker", ["context", "show"], {
        encoding: "utf8",
        env: cleanHostEnvironment(),
        stdio: ["ignore", "pipe", "ignore"],
      });
  const name = (nameResult.stdout ?? "").trim();
  if (nameResult.status !== 0 || !/^[A-Za-z0-9._-]{1,64}$/.test(name))
    throw new LoadTestError("Select a named Docker context before creating a load-test run.");
  const environment = { ...cleanHostEnvironment(), DOCKER_CONTEXT: name };
  const inspected = spawnSync("docker", ["context", "inspect", name], {
    encoding: "utf8",
    env: environment,
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (inspected.status !== 0) throw new LoadTestError("The selected Docker context could not be inspected safely.");
  try {
    const [context] = JSON.parse(inspected.stdout ?? "");
    const endpoint = context?.Endpoints?.docker?.Host;
    if (typeof endpoint !== "string" || endpoint.length > 512) throw new Error("invalid-endpoint");
    let parsed;
    try {
      parsed = new URL(endpoint);
    } catch {
      throw new Error("invalid-endpoint");
    }
    const placement =
      parsed.protocol === "ssh:"
        ? "separate-runner"
        : ["unix:", "npipe:"].includes(parsed.protocol)
          ? "same-machine"
          : "unsupported";
    if (placement === "unsupported" || parsed.password || parsed.search || parsed.hash)
      throw new Error("unsupported-endpoint");
    const fingerprint = createHash("sha256").update(endpoint).digest("hex");
    if (placement === "separate-runner") {
      const username = decodeURIComponent(parsed.username);
      if (
        !/^[A-Za-z0-9._-]*$/.test(username) ||
        !(/^[A-Za-z0-9.-]+$/.test(parsed.hostname) || /^\[[0-9A-Fa-f:.]+\]$/.test(parsed.hostname)) ||
        (parsed.pathname !== "" && parsed.pathname !== "/")
      )
        throw new Error("invalid-ssh-endpoint");
      return { name, endpoint, fingerprint, placement, username, hostname: parsed.hostname, port: parsed.port };
    }
    return { name, endpoint, fingerprint, placement };
  } catch {
    throw new LoadTestError("The selected Docker context must use a local socket or an authenticated SSH endpoint.");
  }
}

export function assertDockerContextMatches(state) {
  const context = inspectDockerContext(state.dockerContext);
  if (context.placement !== state.runnerPlacement || context.fingerprint !== state.dockerContextFingerprint)
    throw new LoadTestError("The selected Docker context changed after this run was created.");
  return context;
}

export function composeArguments(project, state, args) {
  return [
    "compose",
    "--env-file",
    envFilePath(project),
    "--project-name",
    project,
    "-f",
    COMPOSE_FILES[0],
    "-f",
    COMPOSE_FILES[1],
    ...args,
  ];
}

export function runCompose(project, state, args, { capture = false, timeout } = {}) {
  const result = spawnSync("docker", composeArguments(project, state, args), {
    cwd: ROOT,
    encoding: "utf8",
    env: safeComposeEnvironment(project, state),
    stdio: capture ? ["ignore", "pipe", "pipe"] : "ignore",
    ...(timeout ? { timeout } : {}),
  });
  if (result.error || result.status !== 0) throw new LoadTestError(`Docker Compose operation failed (${args[0]}).`);
  return capture ? result.stdout.trim() : "";
}

export function verifyDisposableDatabaseOperation(project, state, operation) {
  const runId = project.slice(PROJECT_PREFIX.length);
  if (
    state.runnerPlacement !== "same-machine" ||
    !DISPOSABLE_DATABASE_OPERATIONS.has(operation) ||
    !/^[0-9a-f]{12,32}$/.test(runId)
  )
    throw new LoadTestError("The database operation does not match a supported local disposable scope.");

  const values = new Map();
  const requiredNames = new Set([
    "POSTGRES_DB",
    "POSTGRES_USER",
    "POSTGRES_PASSWORD",
    "DATABASE_URL",
    "DIRECT_URL",
    ...Object.keys(loadTestResourceProfileEnvironment()),
  ]);
  for (const line of readFileSync(envFilePath(project), "utf8").split(/\r?\n/)) {
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const name = line.slice(0, separator);
    if (!requiredNames.has(name)) continue;
    if (values.has(name)) throw new LoadTestError("The private database configuration is invalid.");
    values.set(name, line.slice(separator + 1));
  }
  const database = values.get("POSTGRES_DB");
  const username = values.get("POSTGRES_USER");
  const password = values.get("POSTGRES_PASSWORD");
  if (
    database !== DATABASE_NAME ||
    typeof username !== "string" ||
    !/^[A-Za-z0-9_.-]{1,64}$/.test(username) ||
    typeof password !== "string" ||
    !/^[0-9a-f]{64}$/.test(password) ||
    !hasExactRunDatabaseUrls(database, username, password, values.get("DATABASE_URL"), values.get("DIRECT_URL")) ||
    Object.entries(loadTestResourceProfileEnvironment()).some(([name, expected]) => values.get(name) !== expected)
  )
    throw new LoadTestError("The private database configuration is invalid.");

  const databaseUrl = `postgresql://${encodeURIComponent(username)}:${encodeURIComponent(password)}@db:5432/${database}?schema=public`;
  const environment = {
    ...cleanHostEnvironment(),
    DOCKER_CONTEXT: state.dockerContext,
    COMPOSE_PROJECT_NAME: project,
    RHSIA_DISPOSABLE_RUN_ID: runId,
    RHSIA_DISPOSABLE_DATA_CLASSIFICATION: "synthetic",
    DATABASE_URL: databaseUrl,
    DIRECT_URL: databaseUrl,
    POSTGRES_DB: database,
    POSTGRES_USER: username,
    POSTGRES_PASSWORD: password,
  };
  const verifierMode =
    operation === "test:loadtest-stack-create" ? "--verify-new-disposable-run-id" : "--disposable-run-id";
  const result = spawnSync(
    process.execPath,
    [path.join(ROOT, "tools/confirm-database-operation.mjs"), verifierMode, runId, operation],
    { cwd: ROOT, env: environment, stdio: "ignore" },
  );
  if (result.error || result.status !== 0)
    throw new LoadTestError("The run-owned database scope was not verified; refusing the operation.");
}

export function hasExactRunDatabaseUrls(database, username, password, databaseUrl, directUrl) {
  const expected = `postgresql://${encodeURIComponent(username)}:${encodeURIComponent(password)}@db:5432/${database}?schema=public`;
  return databaseUrl === expected && directUrl === expected;
}

export function isPostgresReady(project, state) {
  try {
    runCompose(
      project,
      state,
      ["exec", "--no-TTY", "db", "pg_isready", "--quiet", "-U", "loadtest", "-d", DATABASE_NAME],
      {
        timeout: 5_000,
      },
    );
    return true;
  } catch {
    return false;
  }
}
