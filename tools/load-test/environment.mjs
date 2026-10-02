import { LoadTestError } from "./errors.mjs";
import {
  K6_VERSION,
  LOADTEST_SERVICE_RESOURCE_LIMITS,
  MAILPIT_ORIGIN,
  ROOT,
  SAFE_PROCESS_ENVIRONMENT,
} from "./settings.mjs";
import { requiredOption, validateProject, validateTarget } from "./validation.mjs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";

export function createDisposableRunId(dockerContext) {
  const result = spawnSync(
    process.execPath,
    [path.join(ROOT, "tools/confirm-database-operation.mjs"), "--new-disposable-run-id", "rhasia-load"],
    {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...cleanHostEnvironment(), DOCKER_CONTEXT: dockerContext },
      stdio: ["ignore", "pipe", "ignore"],
    },
  );
  if (result.error || result.status !== 0)
    throw new LoadTestError("A fresh local disposable run ID could not be verified.");
  const runId = (result.stdout ?? "").trim();
  if (!/^[0-9a-f]{16}$/.test(runId))
    throw new LoadTestError("The disposable run ID was not a bounded 16-character value.");
  return runId;
}

export function loadTestResourceProfileEnvironment() {
  return Object.fromEntries(
    Object.entries(LOADTEST_SERVICE_RESOURCE_LIMITS).flatMap(([service, limits]) => {
      const key = service.toUpperCase().replaceAll("-", "_");
      return [
        [`LOADTEST_${key}_CPUS`, limits.cpus],
        [`LOADTEST_${key}_MEMORY`, limits.memory],
      ];
    }),
  );
}

export function applyLoadTestResourceProfile(environment) {
  return Object.assign(environment, loadTestResourceProfileEnvironment());
}

export function safeComposeEnvironment(project, state) {
  const environment = Object.fromEntries(
    SAFE_PROCESS_ENVIRONMENT.filter((name) => process.env[name]).map((name) => [name, process.env[name]]),
  );
  // Compose gives shell variables precedence over the private --env-file.
  applyLoadTestResourceProfile(environment);
  environment.COMPOSE_DISABLE_ENV_FILE = "1";
  environment.COMPOSE_PROJECT_NAME = project;
  environment.COMMIT_SHA = state.commit;
  environment.APP_BIND_ADDRESS = "127.0.0.1";
  environment.APP_PORT = "4000";
  environment.WEB_CONTAINER_PORT = "4000";
  environment.MAILPIT_PORT = "8025";
  environment.DOCKER_CONTEXT = state.dockerContext;
  for (const name of ["DOCKER_CONFIG", "SSH_AUTH_SOCK"]) {
    if (process.env[name]) environment[name] = process.env[name];
  }
  return environment;
}

export function safeK6Environment(
  options,
  project,
  summaryPath,
  scenario,
  maxVus,
  duration,
  sessionPoolJson,
  sharedFixturesJson,
) {
  const environment = Object.fromEntries(
    SAFE_PROCESS_ENVIRONMENT.filter((name) => process.env[name]).map((name) => [name, process.env[name]]),
  );
  environment.K6_NO_USAGE_REPORT = "true";
  environment.K6_BROWSER_HEADLESS = "true";
  environment.LOADTEST_TARGET = validateTarget(requiredOption(options, "target"));
  environment.LOADTEST_MAILPIT_ORIGIN = MAILPIT_ORIGIN;
  environment.LOADTEST_PROJECT_ID = validateProject(project);
  environment.LOADTEST_SCENARIO = scenario;
  environment.LOADTEST_MAX_VUS = String(maxVus);
  environment.LOADTEST_DURATION = duration ?? "";
  environment.LOADTEST_BOUNDARY = options.boundary ?? "";
  environment.LOADTEST_SUMMARY_PATH = summaryPath;
  if (sessionPoolJson) environment.LOADTEST_SESSION_POOL = sessionPoolJson;
  if (sharedFixturesJson) environment.LOADTEST_SHARED_FIXTURES = sharedFixturesJson;
  environment.NO_PROXY = "localhost,127.0.0.1,::1";
  environment.no_proxy = environment.NO_PROXY;
  environment.K6_BROWSER_EXECUTABLE_PATH = chromiumExecutablePath();
  return environment;
}

function chromiumExecutablePath() {
  try {
    const requireFromWeb = createRequire(path.join(ROOT, "apps/web/package.json"));
    const executablePath = requireFromWeb("playwright").chromium.executablePath();
    if (!existsSync(executablePath)) throw new Error("missing");
    return executablePath;
  } catch {
    throw new LoadTestError(
      "Pinned Playwright Chromium is unavailable; install the web workspace Chromium browser first.",
    );
  }
}

export function verifyK6Version() {
  const result = spawnSync("k6", ["version"], {
    encoding: "utf8",
    env: cleanHostEnvironment(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0)
    throw new LoadTestError(`Install k6 ${K6_VERSION} before running a load scenario.`);
  const version = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (!new RegExp(`\\bv${K6_VERSION.replaceAll(".", "\\.")}\\b`).test(version))
    throw new LoadTestError(`This suite requires exactly k6 ${K6_VERSION}.`);
  return `k6 v${K6_VERSION}`;
}

export function verifyChromiumVersion() {
  const executable = chromiumExecutablePath();
  const result = spawnSync(executable, ["--version"], {
    encoding: "utf8",
    env: cleanHostEnvironment(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0)
    throw new LoadTestError("The pinned Playwright Chromium executable could not be inspected.");
  return `${result.stdout ?? result.stderr ?? ""}`.trim().slice(0, 100) || "Chromium version unavailable";
}

export function cleanHostEnvironment() {
  const environment = Object.fromEntries(
    SAFE_PROCESS_ENVIRONMENT.filter((name) => process.env[name]).map((name) => [name, process.env[name]]),
  );
  if (process.env.DOCKER_CONFIG) environment.DOCKER_CONFIG = process.env.DOCKER_CONFIG;
  return environment;
}
