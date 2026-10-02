import { cleanHostEnvironment } from "./environment.mjs";
import { LoadTestError } from "./errors.mjs";
import { MAILPIT_ORIGIN, ROOT } from "./settings.mjs";
import { parseBrowserHelperFailurePhase } from "./diagnostics.mjs";
import {
  validateBrowserSessionPool,
  validateBrowserSharedFixtures,
  validateBrowserSharedMutationFixtures,
} from "./validation.mjs";
import { spawn } from "node:child_process";
import path from "node:path";

export function prepareBrowserSessionPool(project, target, count, signal) {
  const environment = browserHelperEnvironment(project, target);
  environment.LOADTEST_POOL_COUNT = String(count);
  return runBrowserJsonHelper(
    path.join(ROOT, "apps/web/scripts/load-test-prepare-pool.mjs"),
    environment,
    count * 45_000 + 60_000,
    (pool) => validateBrowserSessionPool(pool, count),
    "The real passwordless browser session pool failed its bounded structure checks.",
    signal,
  );
}

export function prepareBrowserSharedFixtures(project, target, signal) {
  return runBrowserJsonHelper(
    path.join(ROOT, "apps/web/scripts/load-test-prepare-shared.mjs"),
    browserHelperEnvironment(project, target, "shared-vault"),
    15 * 60_000,
    validateBrowserSharedFixtures,
    "The real Shared Vault browser fixtures failed their bounded structure checks.",
    signal,
  );
}

export function prepareBrowserSharedMutationFixtures(project, target, signal) {
  return runBrowserJsonHelper(
    path.join(ROOT, "apps/web/scripts/load-test-prepare-shared.mjs"),
    browserHelperEnvironment(project, target, "shared-account-mutations"),
    15 * 60_000,
    validateBrowserSharedMutationFixtures,
    "Distinct Shared Vault mutation fixtures failed their bounded structure checks.",
    signal,
  );
}

function browserHelperEnvironment(project, target, scenario) {
  const environment = cleanHostEnvironment();
  environment.LOADTEST_TARGET = target;
  environment.LOADTEST_MAILPIT_ORIGIN = MAILPIT_ORIGIN;
  environment.LOADTEST_PROJECT_ID = project;
  if (scenario) environment.LOADTEST_SCENARIO = scenario;
  return environment;
}

function runBrowserJsonHelper(helperPath, environment, timeoutMs, validate, failureMessage, signal) {
  if (signal.aborted)
    return Promise.reject(new LoadTestError("Browser preparation was cancelled.", "helper_cancelled"));
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [helperPath], {
      cwd: ROOT,
      env: environment,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const chunks = [];
    let byteLength = 0;
    let timedOut = false;
    let overflowed = false;
    let abortTimer;
    const terminate = () => {
      child.kill("SIGTERM");
      abortTimer = setTimeout(() => child.kill("SIGKILL"), 5_000);
    };
    const onAbort = () => terminate();
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) terminate();
    const timeout = setTimeout(() => {
      timedOut = true;
      terminate();
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      const buffer = Buffer.from(chunk);
      byteLength += buffer.byteLength;
      if (byteLength > 512_000) {
        overflowed = true;
        buffer.fill(0);
        child.kill("SIGTERM");
        return;
      }
      chunks.push(buffer);
    });
    child.once("error", () => {
      clearTimeout(timeout);
      clearTimeout(abortTimer);
      signal.removeEventListener("abort", onAbort);
      reject(new LoadTestError("The isolated browser preparation could not start.", "helper_process_start"));
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      clearTimeout(abortTimer);
      signal.removeEventListener("abort", onAbort);
      const output = Buffer.concat(chunks);
      try {
        if (timedOut) throw new LoadTestError(failureMessage, "helper_timeout");
        if (overflowed) throw new LoadTestError(failureMessage, "helper_output_limit");
        if (code !== 0) {
          const phase = parseBrowserHelperFailurePhase(output.toString("utf8"));
          throw new LoadTestError(failureMessage, phase ?? "helper_failed_unclassified");
        }
        let value;
        try {
          value = JSON.parse(output.toString("utf8"));
          validate(value);
        } catch {
          throw new LoadTestError(failureMessage, "helper_output_validation");
        }
        resolve(value);
      } catch (error) {
        reject(error instanceof LoadTestError ? error : new LoadTestError(failureMessage));
      } finally {
        output.fill(0);
        for (const chunk of chunks) chunk.fill(0);
        chunks.length = 0;
      }
    });
  });
}
