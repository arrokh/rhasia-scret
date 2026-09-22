import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

export const SELF_HOSTED_PROJECT_NAME = "rhasia-scret-selfhosted";
export const SELF_HOSTED_COMPOSE_FILES = ["docker-compose.yml"];

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requiredComposeValues = ["POSTGRES_PASSWORD", "PROXY_SECRET", "API_PROXY_SECRET", "CRON_SECRET"];
const requiredOrigins = ["WEB_ORIGIN", "API_ORIGIN"];
const supportedAuthBackends = new Set(["none", "passwordless", "oidc"]);
const placeholderPattern = /^replace-with-/i;
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

export function parseEnvFile(source) {
  const values = {};
  for (const line of source.split(/\r?\n/u)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u);
    if (!match) continue;
    values[match[1]] = unquote(match[2].trim());
  }
  return values;
}

export function validateSelfHostedEnvironment(values) {
  const errors = [];

  for (const name of requiredComposeValues) {
    const value = values[name]?.trim();
    if (!isExampleValue(value)) continue;
    if (name === "POSTGRES_PASSWORD") {
      errors.push(
        "POSTGRES_PASSWORD is still an example placeholder; set it manually so an existing database credential is not rotated.",
      );
      continue;
    }
    errors.push(`${name} must be set to a non-placeholder value in .env.`);
  }

  const proxySecret = values.PROXY_SECRET?.trim();
  const apiProxySecret = values.API_PROXY_SECRET?.trim();
  if (!isExampleValue(proxySecret) && !isExampleValue(apiProxySecret) && proxySecret !== apiProxySecret) {
    errors.push("PROXY_SECRET and API_PROXY_SECRET must match for the web-to-API proxy.");
  }

  for (const name of ["PROXY_SECRET", "API_PROXY_SECRET", "CRON_SECRET"]) {
    const value = values[name]?.trim();
    if (value && value.length < 32) errors.push(`${name} must contain at least 32 characters.`);
  }

  const databasePassword = values.POSTGRES_PASSWORD?.trim();
  if (databasePassword && !/^[A-Za-z0-9._~-]+$/u.test(databasePassword)) {
    errors.push("POSTGRES_PASSWORD must contain only URL-safe characters.");
  }

  const backend = values.AUTH_BACKEND?.trim();
  if (!backend) {
    errors.push("AUTH_BACKEND must be set explicitly to none, passwordless, or oidc.");
  } else if (!supportedAuthBackends.has(backend)) {
    errors.push("AUTH_BACKEND must be none, passwordless, or oidc.");
  }

  for (const name of requiredOrigins) {
    requireHttpsOrigin(values[name], name, errors);
  }

  if (backend === "passwordless" && !values.AUTH_APP_ORIGIN?.trim()) {
    errors.push("AUTH_APP_ORIGIN is required when AUTH_BACKEND=passwordless.");
  }

  if (values.AUTH_APP_ORIGIN?.trim()) requireHttpsOrigin(values.AUTH_APP_ORIGIN, "AUTH_APP_ORIGIN", errors);
  if (backend === "oidc" && values.OIDC_REDIRECT_URI?.trim()) {
    requireHttpsOrigin(values.OIDC_REDIRECT_URI, "OIDC_REDIRECT_URI", errors, { originOnly: false });
  }

  return errors;
}

export function setEnvValue(source, name, value) {
  const line = `${name}=${value}`;
  const pattern = new RegExp(`^${escapeRegExp(name)}=.*$`, "mu");
  if (pattern.test(source)) return source.replace(pattern, line);
  return `${source.trimEnd()}\n${line}\n`;
}

export function ensureLocalEnvironment({ root = repositoryRoot, commitSha = "local" } = {}) {
  const envPath = resolve(root, ".env");
  const examplePath = resolve(root, ".env.example");
  if (!existsSync(examplePath)) throw new Error("Missing .env.example; cannot create the self-hosted environment.");

  if (!existsSync(envPath)) {
    const databasePassword = randomSecret();
    const proxySecret = randomSecret();
    let source = readFileSync(examplePath, "utf8");
    source = setEnvValue(source, "AUTH_BACKEND", "none");
    source = setEnvValue(source, "POSTGRES_PASSWORD", databasePassword);
    source = setEnvValue(source, "PROXY_SECRET", proxySecret);
    source = setEnvValue(source, "API_PROXY_SECRET", proxySecret);
    source = setEnvValue(source, "CRON_SECRET", randomSecret());
    source = setEnvValue(source, "DATABASE_URL", localDatabaseUrl(databasePassword));
    source = setEnvValue(source, "DIRECT_URL", localDatabaseUrl(databasePassword));
    source = setEnvValue(source, "COMMIT_SHA", commitSha);

    try {
      writeFileSync(envPath, source, { encoding: "utf8", mode: 0o600, flag: "wx" });
    } catch (error) {
      if (!isFileExistsError(error)) throw error;
      return ensureLocalEnvironment({ root, commitSha });
    }
    chmodSync(envPath, 0o600);
    return { created: true, updated: false, envPath };
  }

  const original = readFileSync(envPath, "utf8");
  const values = parseEnvFile(original);
  let source = original;
  let updated = false;
  const databasePassword = values.POSTGRES_PASSWORD;
  const proxySecret = sharedProxySecret(values.PROXY_SECRET, values.API_PROXY_SECRET);
  const apiProxySecret = isExampleValue(values.API_PROXY_SECRET) ? proxySecret : values.API_PROXY_SECRET;
  const cronSecret = isExampleValue(values.CRON_SECRET) ? randomSecret() : values.CRON_SECRET;

  for (const [name, value] of [
    ["PROXY_SECRET", proxySecret],
    ["API_PROXY_SECRET", apiProxySecret],
    ["CRON_SECRET", cronSecret],
  ]) {
    if (isExampleValue(values[name])) {
      source = setEnvValue(source, name, value);
      updated = true;
    }
  }

  if (isExampleUrl(values.DATABASE_URL) && !isExampleValue(databasePassword)) {
    source = setEnvValue(source, "DATABASE_URL", localDatabaseUrl(databasePassword));
    updated = true;
  }
  if (isExampleUrl(values.DIRECT_URL) && !isExampleValue(databasePassword)) {
    source = setEnvValue(source, "DIRECT_URL", localDatabaseUrl(databasePassword));
    updated = true;
  }

  if (!updated) return { created: false, updated: false, envPath };
  writeFileSync(envPath, source, { encoding: "utf8" });
  chmodSync(envPath, 0o600);
  return { created: false, updated: true, envPath };
}

export function composeArguments(root = repositoryRoot, commandArguments = []) {
  const relativeFiles = SELF_HOSTED_COMPOSE_FILES.map((file) => ["-f", file]).flat();
  return ["compose", ...relativeFiles, ...commandArguments];
}

export function selfHostedUpComposeCommands() {
  return {
    build: ["build"],
    start: ["up", "-d", "--wait", "--wait-timeout", "120", "--remove-orphans", "--no-build"],
  };
}

export function loadContext(root = repositoryRoot, { requireEnvironment = true } = {}) {
  const envPath = resolve(root, ".env");
  const hasEnvironment = existsSync(envPath);
  if (requireEnvironment && !hasEnvironment) {
    throw new Error("Missing .env. Run `pnpm selfhosted:setup` to create and verify it.");
  }

  for (const file of SELF_HOSTED_COMPOSE_FILES) {
    if (!existsSync(resolve(root, file))) throw new Error(`Missing ${file}.`);
  }

  const source = hasEnvironment ? readFileSync(envPath, "utf8") : "";
  return { root, envPath, hasEnvironment, values: parseEnvFile(source) };
}

export function validateRepositoryContext(context) {
  if (!context.hasEnvironment) return ["Missing .env."];
  return validateSelfHostedEnvironment(context.values);
}

function main(command, root = repositoryRoot) {
  if (!command || !["setup", "up", "down"].includes(command)) {
    throw new Error("Usage: pnpm selfhosted:setup | pnpm selfhosted:up | pnpm selfhosted:down");
  }

  if (command === "setup") return setup(root);
  if (command === "up") return up(root);
  return down(root);
}

function setup(root) {
  const commitSha = readCommitSha(root);
  const environment = ensureLocalEnvironment({ root, commitSha });
  if (environment.created) {
    console.log("Created .env with local-only authentication and generated local secrets.");
    console.log("Set AUTH_BACKEND=passwordless or oidc before selfhosted:up when hosted authentication is required.");
  } else if (environment.updated) {
    console.log("Replaced missing/example local Compose values in .env; existing configured values were preserved.");
  }

  const context = loadContext(root);
  verifyDocker(root);
  verifyEnvironment(context);
  runCommand(pnpmCommand, ["install", "--frozen-lockfile"], { cwd: root, label: "pnpm install" });
  verifyDeploymentConfiguration(root);
  runCompose(context, ["config", "--quiet"]);
  runCompose(context, ["up", "-d", "--wait", "--wait-timeout", "120", "db"]);
  runCommand(process.execPath, ["tools/confirm-database-operation.mjs", "the self-hosted database migration"], {
    cwd: root,
    label: "database migration confirmation",
  });
  runCompose(context, ["run", "--build", "--rm", "migrate"]);
  console.log("Self-hosted setup complete. Run `pnpm selfhosted:up` to build and start all services.");
}

function up(root) {
  const context = loadContext(root);
  verifyDocker(root);
  verifyEnvironment(context);
  verifyDeploymentConfiguration(root);
  runCompose(context, ["config", "--quiet"]);
  const commands = selfHostedUpComposeCommands();
  console.log("Building self-hosted application images...");
  runCompose(context, commands.build);
  console.log("Starting self-hosted services and waiting for health checks...");
  try {
    runCompose(context, commands.start);
  } catch (error) {
    printComposeStatus(context);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Self-hosted services did not become healthy. ${message}`);
  }
  console.log("Self-hosted services are running at the configured WEB_ORIGIN.");
}

function down(root) {
  const context = loadContext(root, { requireEnvironment: false });
  verifyDocker(root);
  runCompose(context, ["down", "--remove-orphans"], { allowMissingEnvironment: true });
  console.log("Self-hosted services stopped. The PostgreSQL volume was preserved.");
}

function verifyDocker(root) {
  runCommand("docker", ["compose", "version"], { cwd: root, label: "Docker Compose verification" });
  runCommand("docker", ["info", "--format", "{{.ServerVersion}}"], {
    cwd: root,
    label: "Docker daemon verification",
  });
}

function verifyEnvironment(context) {
  const errors = validateRepositoryContext(context);
  if (errors.length > 0) {
    throw new Error(`Self-hosted environment verification failed:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  }
}

function verifyDeploymentConfiguration(root) {
  runCommand(pnpmCommand, ["run", "verify:deployment-config"], {
    cwd: root,
    env: { ...process.env, NODE_ENV: "development" },
    label: "application configuration verification",
  });
}

function printComposeStatus(context) {
  const result = spawnSync("docker", composeArguments(context.root, ["ps", "--all"]), {
    cwd: context.root,
    env: {
      ...process.env,
      COMPOSE_PROJECT_NAME: SELF_HOSTED_PROJECT_NAME,
      COMMIT_SHA: readCommitSha(context.root),
    },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const status = result.stdout?.trim();
  if (status) console.error(`Self-hosted service status:\n${status}`);
}

function runCompose(context, commandArguments, { allowMissingEnvironment = false } = {}) {
  const env = {
    ...process.env,
    COMPOSE_PROJECT_NAME: SELF_HOSTED_PROJECT_NAME,
    COMMIT_SHA: readCommitSha(context.root),
  };

  if (allowMissingEnvironment) {
    for (const name of requiredComposeValues) {
      if (!context.values[name]?.trim()) env[name] = "selfhosted-down-placeholder";
    }
  }

  runCommand("docker", composeArguments(context.root, commandArguments), {
    cwd: context.root,
    env,
    label: `docker compose ${commandArguments.join(" ")}`,
  });
}

function runCommand(command, arguments_, { cwd, env = process.env, label, stdio = "inherit" }) {
  const result = spawnSync(command, arguments_, { cwd, env, stdio });
  if (result.error) throw new Error(`${label} could not start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${label} failed with exit code ${result.status ?? "unknown"}.`);
}

function readCommitSha(root) {
  const result = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) throw new Error("Unable to determine the current Git commit SHA.");
  const commitSha = result.stdout.trim();
  if (!commitSha) throw new Error("The current Git commit SHA is empty.");
  return commitSha;
}

function requireHttpsOrigin(value, name, errors, { originOnly = true } = {}) {
  if (!value?.trim()) {
    errors.push(`${name} must be set in .env.`);
    return;
  }

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" && !isLocalHttpOrigin(parsed)) {
      errors.push(`${name} must use HTTPS unless this is localhost HTTP self-hosting.`);
    }
    if (parsed.username || parsed.password) errors.push(`${name} must not contain credentials.`);
    if (originOnly && (parsed.pathname !== "/" || parsed.search || parsed.hash))
      errors.push(`${name} must contain only an origin.`);
  } catch {
    errors.push(`${name} must be a valid URL.`);
  }
}

function localDatabaseUrl(password) {
  return `postgresql://rhasia:${password}@127.0.0.1:55432/shared_totp_vault?schema=public`;
}

function randomSecret() {
  return randomBytes(32).toString("hex");
}

function sharedProxySecret(proxySecret, apiProxySecret) {
  if (!isExampleValue(proxySecret)) return proxySecret;
  if (!isExampleValue(apiProxySecret)) return apiProxySecret;
  return randomSecret();
}

function isExampleValue(value) {
  return !value?.trim() || placeholderPattern.test(value);
}

function isExampleUrl(value) {
  return !value?.trim() || /replace-with-/i.test(value);
}

function isLocalHttpOrigin(value) {
  let parsed = value;
  if (!(parsed instanceof URL)) {
    try {
      parsed = new URL(value);
    } catch {
      return false;
    }
  }
  return parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname);
}

function isFileExistsError(error) {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

function unquote(value) {
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv[2]);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
