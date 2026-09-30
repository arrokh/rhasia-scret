import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createInterface } from "node:readline/promises";
import process from "node:process";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const disposableRunIdPattern = /^[a-f0-9]{12,32}$/u;
const disposableProjectPrefixes = ["rhasia-load-", "rhasia-scret-test-"];

export function isLocalDockerContext(contexts) {
  if (!Array.isArray(contexts) || contexts.length !== 1) return false;
  const endpoint = contexts[0]?.Endpoints?.docker?.Host;
  if (typeof endpoint !== "string") return false;
  if (endpoint.startsWith("unix:///")) {
    try {
      const socket = new URL(endpoint);
      return (
        socket.protocol === "unix:" &&
        !socket.hostname &&
        socket.pathname.startsWith("/") &&
        !socket.pathname.startsWith("//") &&
        !socket.pathname.split("/").includes("..") &&
        !socket.search &&
        !socket.hash
      );
    } catch {
      return false;
    }
  }
  const namedPipePrefix = "npipe:////./pipe/";
  return endpoint.startsWith(namedPipePrefix) && /^[a-z0-9_.-]+$/iu.test(endpoint.slice(namedPipePrefix.length));
}

export function validateDisposableDatabaseScope({ runId, operation, environment, container, volume }) {
  const errors = [];
  if (!disposableRunIdPattern.test(runId ?? "")) {
    errors.push("Run ID must be 12–32 lowercase hexadecimal characters.");
  }

  const projectName = environment.COMPOSE_PROJECT_NAME;
  if (!disposableProjectPrefixes.some((prefix) => projectName === `${prefix}${runId}`)) {
    errors.push("Compose project name must be a run-scoped test project matching the run ID.");
  }
  if (environment.RHSIA_DISPOSABLE_RUN_ID !== runId) {
    errors.push("Disposable run ID environment marker does not match.");
  }
  if (environment.RHSIA_DISPOSABLE_DATA_CLASSIFICATION !== "synthetic") {
    errors.push("Disposable test data must be explicitly classified as synthetic.");
  }
  if (!/^test:[a-z0-9][a-z0-9:_-]*$/iu.test(operation ?? "")) {
    errors.push("Automated database operations must be labeled with a test: operation.");
  }
  if (!container) return [...errors, "A matching run-owned PostgreSQL container is required."];

  const labels = container.Config?.Labels ?? {};
  if (container.State?.Status !== "running") errors.push("The run-owned PostgreSQL container is not running.");
  if (labels["com.docker.compose.project"] !== projectName) {
    errors.push("PostgreSQL container does not belong to the requested Compose project.");
  }
  if (labels["com.docker.compose.service"] !== "db") {
    errors.push("The matching Compose service is not the database service.");
  }
  if (!isPostgresImage(container.Config?.Image)) {
    errors.push("The run-owned database must use the PostgreSQL image.");
  }

  const workingDirectory = labels["com.docker.compose.project.working_dir"];
  if (!isRepositoryPath(workingDirectory)) {
    errors.push("The Compose project must be created from this repository.");
  }

  const containerEnvironment = parseEnvironment(container.Config?.Env);
  const mounts = container.Mounts ?? [];
  const expectedVolumePrefix = `${projectName}_`;
  if (
    mounts.length !== 1 ||
    mounts[0]?.Type !== "volume" ||
    !mounts[0]?.Name?.startsWith(expectedVolumePrefix) ||
    mounts[0]?.Destination !== "/var/lib/postgresql/data" ||
    volume?.Name !== mounts[0]?.Name ||
    volume?.Driver !== "local" ||
    volume?.Labels?.["com.docker.compose.project"] !== projectName
  ) {
    errors.push("Database storage must be a single local volume owned by this Compose project.");
  }

  const bindings = container.NetworkSettings?.Ports?.["5432/tcp"];
  if (!Array.isArray(bindings) || bindings.length === 0) {
    errors.push("PostgreSQL must publish a local host port for test connections.");
  } else if (bindings.some((binding) => !isLoopback(binding.HostIp))) {
    errors.push("PostgreSQL must bind only to the local loopback interface.");
  }

  const databaseUrls = [environment.DATABASE_URL, environment.DIRECT_URL];
  const parsedUrls = databaseUrls.map(parseDatabaseUrl);
  if (parsedUrls.some((url) => url === undefined)) {
    errors.push("Both database URLs must target a local PostgreSQL test database.");
  } else {
    for (const url of parsedUrls) {
      const mapsToContainer = bindings?.some(
        (binding) => isLoopback(binding.HostIp) && Number(binding.HostPort) === url.port,
      );
      if (!mapsToContainer) errors.push("Database URL port does not map to this run-owned container.");
      if (
        url.username !== containerEnvironment.POSTGRES_USER ||
        url.password !== containerEnvironment.POSTGRES_PASSWORD ||
        url.database !== containerEnvironment.POSTGRES_DB
      ) {
        errors.push("Database URL credentials or database do not match the run-owned container.");
      }
    }
  }

  return [...new Set(errors)];
}

function parseDatabaseUrl(value) {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") return undefined;
    if (!isLoopback(url.hostname) || url.hash) return undefined;
    const queryKeys = [...url.searchParams.keys()];
    if (queryKeys.some((key) => key.toLowerCase() !== "schema") || url.searchParams.getAll("schema").length > 1) {
      return undefined;
    }
    const database = decodeURIComponent(url.pathname.replace(/^\//u, ""));
    return {
      username: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database,
      port: Number(url.port || "5432"),
    };
  } catch {
    return undefined;
  }
}

function parseEnvironment(entries) {
  if (!Array.isArray(entries)) return {};
  return Object.fromEntries(
    entries.flatMap((entry) => {
      const separator = entry.indexOf("=");
      if (separator <= 0) return [];
      return [[entry.slice(0, separator), entry.slice(separator + 1)]];
    }),
  );
}

function isPostgresImage(image) {
  return typeof image === "string" && /^postgres(?::|@)/iu.test(image);
}

function isRepositoryPath(path) {
  if (typeof path !== "string" || path.length === 0) return false;
  const relativePath = relative(repositoryRoot, resolve(path));
  return (
    !isAbsolute(relativePath) &&
    relativePath !== ".." &&
    !relativePath.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
  );
}

function isLoopback(host) {
  return host === "127.0.0.1" || host === "localhost";
}

function inspectRunOwnedDatabase(projectName) {
  verifyLocalDockerContext();
  const listing = runDocker([
    "ps",
    "--filter",
    `label=com.docker.compose.project=${projectName}`,
    "--filter",
    "label=com.docker.compose.service=db",
    "--format",
    "{{.ID}}",
  ]);
  const containerIds = listing.split(/\s+/u).filter(Boolean);
  if (containerIds.length !== 1) return undefined;

  const inspectedContainer = runDocker(["inspect", containerIds[0]]);
  let container;
  try {
    const containers = JSON.parse(inspectedContainer);
    if (!Array.isArray(containers) || containers.length !== 1) return undefined;
    container = containers[0];
  } catch {
    return undefined;
  }

  const mount = container.Mounts?.find((candidate) => candidate.Destination === "/var/lib/postgresql/data");
  if (mount?.Type !== "volume" || !mount.Name) return { container };

  const inspectedVolume = runDocker(["volume", "inspect", mount.Name]);
  try {
    const volumes = JSON.parse(inspectedVolume);
    return { container, volume: Array.isArray(volumes) && volumes.length === 1 ? volumes[0] : undefined };
  } catch {
    return { container };
  }
}

function runDocker(arguments_) {
  const result = spawnSync("docker", arguments_, {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.error || result.status !== 0) throw new Error("Docker inspection failed.");
  return result.stdout.trim();
}

async function confirmInteractively(operation) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error("Database operations require confirmation from an interactive terminal.");
    process.exitCode = 1;
    return;
  }

  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await readline.question(`About to ${operation}. Type \"yes\" to continue: `);
    if (answer.trim().toLowerCase() !== "yes") {
      console.error("Database operation cancelled.");
      process.exitCode = 1;
    }
  } catch {
    console.error("Database operation cancelled.");
    process.exitCode = 1;
  } finally {
    readline.close();
  }
}

function verifyLocalDockerContext() {
  let contexts;
  try {
    contexts = JSON.parse(runDocker(["context", "inspect"]));
  } catch {
    throw new Error("Unable to verify the local Docker context.");
  }
  if (!isLocalDockerContext(contexts)) throw new Error("Disposable test databases require a local Docker context.");
}

function hasComposeProjectResources(projectName) {
  verifyLocalDockerContext();
  const projectFilter = `label=com.docker.compose.project=${projectName}`;
  const nameFilter = `name=${projectName}`;
  const resources = [
    ["ps", "-aq"],
    ["volume", "ls", "-q"],
    ["network", "ls", "-q"],
  ];
  const commands = resources.flatMap((command) =>
    [projectFilter, nameFilter].map((filter) => [...command, "--filter", filter]),
  );
  return commands.some((arguments_) => runDocker(arguments_).split(/\\s+/u).filter(Boolean).length > 0);
}

async function main(arguments_) {
  const [mode, ...remaining] = arguments_;
  if (mode === "--new-disposable-run-id") {
    const [prefix, ...extra] = remaining;
    const allowedPrefixes = ["rhasia-load", "rhasia-scret-test"];
    if (extra.length > 0 || (prefix && !allowedPrefixes.includes(prefix))) {
      console.error("Usage: confirm-database-operation.mjs --new-disposable-run-id [rhasia-load|rhasia-scret-test]");
      process.exitCode = 1;
      return;
    }

    try {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const runId = randomBytes(8).toString("hex");
        const projectName = `${prefix ?? "rhasia-scret-test"}-${runId}`;
        if (!hasComposeProjectResources(projectName)) {
          console.log(runId);
          return;
        }
      }
    } catch {
      console.error("Unable to verify a fresh disposable Compose project; refusing to continue.");
      process.exitCode = 1;
      return;
    }

    console.error("Unable to allocate an unused disposable Compose project; refusing to continue.");
    process.exitCode = 1;
    return;
  }

  if (mode === "--disposable-run-id") {
    const [runId, operation, ...extra] = remaining;
    if (!runId || !operation || extra.length > 0) {
      console.error('Usage: confirm-database-operation.mjs --disposable-run-id <hex-id> "test:<operation>"');
      process.exitCode = 1;
      return;
    }

    let inspectedDatabase;
    try {
      const projectName = process.env.COMPOSE_PROJECT_NAME;
      inspectedDatabase = projectName ? inspectRunOwnedDatabase(projectName) : undefined;
    } catch {
      inspectedDatabase = undefined;
    }
    const errors = validateDisposableDatabaseScope({
      runId,
      operation,
      environment: process.env,
      container: inspectedDatabase?.container,
      volume: inspectedDatabase?.volume,
    });
    if (errors.length > 0) {
      console.error(`Disposable test database scope rejected: ${errors.join(" ")}`);
      process.exitCode = 1;
      return;
    }

    console.log("Verified isolated, run-owned synthetic PostgreSQL test database.");
    return;
  }

  if (mode?.startsWith("--")) {
    console.error("Unknown database-operation mode; refusing to continue.");
    process.exitCode = 1;
    return;
  }
  await confirmInteractively(arguments_.join(" ") || "this database operation");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main(process.argv.slice(2));
}
