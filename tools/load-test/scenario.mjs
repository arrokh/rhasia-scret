import {
  assertDockerContextMatches,
  isPostgresReady,
  runCompose,
  verifyDisposableDatabaseOperation,
} from "./docker.mjs";
import { safeK6Environment, verifyChromiumVersion, verifyK6Version } from "./environment.mjs";
import { LoadTestError, createCancellation } from "./errors.mjs";
import {
  prepareBrowserSessionPool,
  prepareBrowserSharedFixtures,
  prepareBrowserSharedMutationFixtures,
} from "./fixtures.mjs";
import { isHealthy, startRunnerTunnel, stopRunnerTunnel, waitForTargetHealth } from "./network.mjs";
import {
  aggregateRateLimitMetrics,
  captureK6ProcessSnapshot,
  captureResourceSnapshots,
  captureSshTunnelProcessSnapshot,
  machineSummary,
  readSanitizedSummary,
  renderMarkdownSummary,
  resultDirectory,
  stackHostSummary,
  scenarioProfile,
} from "./reporting.mjs";
import { LOADTEST_SERVICE_RESOURCE_LIMITS, MAX_CAPACITY_SESSION_POOL_SIZE, ROOT, WEB_ORIGIN } from "./settings.mjs";
import { gitWorkingTreeClean, readState, writeState } from "./state.mjs";
import { teardown } from "./teardown.mjs";
import { firstTimeAssertionFailureDetail, rateLimitAssertionFailureDetail } from "./diagnostics.mjs";
import {
  requiredOption,
  shouldPreserveFailedRun,
  validateFreshScenarioState,
  validateProject,
  validateRunnerPlacementOption,
  validateScenario,
  validateTarget,
} from "./validation.mjs";
import { spawn } from "node:child_process";
import { chmodSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

function validateRunReadiness(project, state, target) {
  if (target !== state.target) throw new LoadTestError("The target does not match this run's Compose project.");
  assertDockerContextMatches(state);
  validateFreshScenarioState(state);
  if (!state.migrationCompleted)
    throw new LoadTestError("Run the separately authorized disposable-database migration first.");
  const services = runCompose(project, state, ["ps", "--status", "running", "--services"], { capture: true })
    .split(/\r?\n/)
    .filter(Boolean);
  const required = ["db", "mailpit", "api", "web", "retention-purge"];
  if (!required.every((service) => services.includes(service)))
    throw new LoadTestError("The exact run-owned Compose project is not fully running.");
}

export async function runScenario(options) {
  const project = validateProject(requiredOption(options, "project"));
  const target = validateTarget(requiredOption(options, "target"));
  const state = readState(project);
  validateRunnerPlacementOption(options, state);
  if (target !== state.target) throw new LoadTestError("The target does not match this run's Compose project.");
  assertDockerContextMatches(state);
  let configured;
  let k6Version;
  let chromiumVersion;
  let directory;
  try {
    validateRunReadiness(project, state, target);
    configured = validateScenario(options, state);
    k6Version = verifyK6Version();
    chromiumVersion = verifyChromiumVersion();
    directory = resultDirectory(project);
  } catch (error) {
    if (!shouldPreserveFailedRun(options)) await teardown(project, state);
    throw error;
  }
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
  const summaryPath = path.join(directory, `${configured.scenario}-${stamp}.summary.tmp`);
  const summaryReportPath = path.join(directory, `${configured.scenario}-${stamp}.summary.md`);
  const reportPath = path.join(directory, `${configured.scenario}-${stamp}.report.json`);
  const runRecord = {
    schemaVersion: 2,
    project,
    scenario: configured.scenario,
    target,
    boundary: options.boundary ?? null,
    runnerPlacement: state.runnerPlacement,
    resourceProfile: state.resourceProfile,
    serviceResourceLimits: LOADTEST_SERVICE_RESOURCE_LIMITS,
    migrationDockerPeak: state.migrationDockerPeak,
    networkPath:
      state.runnerPlacement === "separate-runner"
        ? "authenticated SSH forwards to run-owned host loopback ports 4000 and 8025"
        : "same-machine loopback",
    dockerContext: state.dockerContext,
    loadGenerator: machineSummary(),
    stackHost: stackHostSummary(project, state),
    gitCommit: state.commit,
    workingTreeCleanAtCreate: state.workingTreeCleanAtCreate,
    workingTreeCleanAtRun: gitWorkingTreeClean(),
    versions: { k6: k6Version, browserModule: `k6/browser bundled with ${k6Version}`, chromium: chromiumVersion },
    dockerSnapshots: [],
    postgresSnapshots: [],
    k6ProcessSnapshots: [],
    sshTunnelProcessSnapshots: [],
    profile: scenarioProfile(configured, options),
    preparedAt: new Date().toISOString(),
    scenarioStartedAt: null,
    failurePhase: null,
    failurePhaseDetail: null,
    stopReason: null,
    k6ExitCode: null,
    applicationRateLimits: null,
  };
  state.loadScenario = configured.scenario;
  state.loadScenarioStartedAt = new Date().toISOString();
  writeState(project, state);
  let exitCode = 1;
  let k6Summary = null;
  let tunnel = null;
  const cancellation = createCancellation(() => stopRunnerTunnel(tunnel));
  let resourceTimer;
  let sessionPoolJson = "";
  let sharedFixturesJson = "";
  let failurePhase = "runner_tunnel";
  try {
    tunnel = await startRunnerTunnel(state, cancellation.signal);
    failurePhase = "web_health_preflight";
    await waitForTargetHealth(tunnel, cancellation.signal);
    failurePhase = "postgres_health_preflight";
    if (!isPostgresReady(project, state))
      throw new LoadTestError("The run-owned PostgreSQL service is not accepting connections.");
    if (["returning-personal", "account-mutations", "browser-smoke", "capacity"].includes(configured.scenario)) {
      failurePhase = "passwordless_session_pool_preparation";
      const poolSize =
        configured.scenario === "browser-smoke" ? 1 : Math.min(configured.maxVus, MAX_CAPACITY_SESSION_POOL_SIZE);
      verifyDisposableDatabaseOperation(project, state, "test:loadtest-session-pool");
      const sessionPool = await prepareBrowserSessionPool(project, target, poolSize, cancellation.signal);
      sessionPoolJson = JSON.stringify(sessionPool);
    }
    if (configured.scenario === "shared-vault") {
      failurePhase = "shared_vault_fixture_preparation";
      verifyDisposableDatabaseOperation(project, state, "test:loadtest-shared-vault-fixtures");
      const fixtures = await prepareBrowserSharedFixtures(project, target, cancellation.signal);
      sharedFixturesJson = JSON.stringify(fixtures);
    }
    if (configured.scenario === "shared-account-mutations") {
      failurePhase = "shared_mutation_fixture_preparation";
      verifyDisposableDatabaseOperation(project, state, "test:loadtest-shared-mutation-fixtures");
      const fixtures = await prepareBrowserSharedMutationFixtures(project, target, cancellation.signal);
      sharedFixturesJson = JSON.stringify(fixtures);
    }
    failurePhase = "k6_scenario";
    verifyDisposableDatabaseOperation(project, state, "test:loadtest-scenario");
    runRecord.scenarioStartedAt = new Date().toISOString();
    captureResourceSnapshots(runRecord, project, state);
    resourceTimer = setInterval(() => captureResourceSnapshots(runRecord, project, state), 15_000);
    exitCode = await runK6(
      configured,
      options,
      project,
      summaryPath,
      sessionPoolJson,
      sharedFixturesJson,
      runRecord,
      tunnel,
      cancellation.signal,
      state,
    );
    k6Summary = readSanitizedSummary(summaryPath);
    if (configured.scenario === "first-time") {
      runRecord.failurePhaseDetail = firstTimeAssertionFailureDetail(k6Summary);
      if (runRecord.failurePhaseDetail) exitCode = 1;
    }
    if (configured.scenario === "rate-limits") {
      runRecord.failurePhaseDetail = rateLimitAssertionFailureDetail(k6Summary, options.boundary);
      if (runRecord.failurePhaseDetail) exitCode = 1;
    }
    sessionPoolJson = "";
    sharedFixturesJson = "";
    runRecord.k6ExitCode = exitCode;
    runRecord.stopReason = exitCode === 0 ? "completed" : "k6_failed";
    runRecord.failurePhase = exitCode === 0 ? null : failurePhase;
  } catch (error) {
    sessionPoolJson = "";
    sharedFixturesJson = "";
    runRecord.failurePhase = failurePhase;
    runRecord.failurePhaseDetail = error instanceof LoadTestError ? error.failurePhaseDetail : null;
    runRecord.stopReason = cancellation.signal.aborted
      ? "cancelled"
      : error instanceof LoadTestError
        ? "preflight_or_health_failure"
        : "runner_failure";
    runRecord.k6ExitCode = exitCode;
  } finally {
    if (resourceTimer) clearInterval(resourceTimer);
    try {
      captureResourceSnapshots(runRecord, project, state);
      runRecord.endedAt = new Date().toISOString();
      runRecord.applicationRateLimits = aggregateRateLimitMetrics(project, state);
      k6Summary ??= readSanitizedSummary(summaryPath);
      writeFileSync(summaryReportPath, renderMarkdownSummary(runRecord, k6Summary), {
        flag: "wx",
        mode: 0o600,
      });
      chmodSync(summaryReportPath, 0o600);
      writeFileSync(reportPath, `${JSON.stringify(runRecord, null, 2)}\n`, { flag: "wx", mode: 0o600 });
      chmodSync(reportPath, 0o600);
    } finally {
      try {
        rmSync(summaryPath, { force: true });
      } finally {
        try {
          if (exitCode === 0 ? !options["keep-stack"] : !shouldPreserveFailedRun(options))
            await teardown(project, state);
        } finally {
          stopRunnerTunnel(tunnel);
          cancellation.dispose();
        }
      }
    }
  }
  console.log(`summary=${path.relative(ROOT, summaryReportPath)}`);
  console.log(`report=${path.relative(ROOT, reportPath)}`);
  console.log(`scenario=${configured.scenario}`);
  console.log(`result=${exitCode === 0 ? "passed" : "failed"}`);
  if (exitCode !== 0)
    throw new LoadTestError("Load scenario failed; only sanitized summary and telemetry reports were retained.");
}

function runK6(
  configured,
  options,
  project,
  summaryPath,
  sessionPoolJson,
  sharedFixturesJson,
  runRecord,
  tunnel,
  signal,
  state,
) {
  if (signal.aborted) return Promise.reject(new LoadTestError("The k6 scenario was cancelled."));
  const scriptPath = path.join(ROOT, "performance", "k6", configured.script);
  const environment = safeK6Environment(
    options,
    project,
    summaryPath,
    configured.scenario,
    configured.maxVus,
    configured.duration,
    sessionPoolJson,
    sharedFixturesJson,
  );
  return new Promise((resolve, reject) => {
    const child = spawn("k6", ["run", "--include-system-env-vars", scriptPath], {
      cwd: ROOT,
      env: environment,
      stdio: "ignore",
    });
    let healthTimer;
    let processTimer;
    let forceTimer;
    let stopError;
    let settled = false;
    const terminate = (error) => {
      if (settled || stopError) return;
      stopError = error;
      child.kill("SIGTERM");
      forceTimer = setTimeout(() => child.kill("SIGKILL"), 5_000);
    };
    const onAbort = () => terminate(new LoadTestError("The k6 scenario was cancelled."));
    signal.addEventListener("abort", onAbort, { once: true });
    const finish = (error, code) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      if (healthTimer) clearInterval(healthTimer);
      if (processTimer) clearInterval(processTimer);
      clearTimeout(forceTimer);
      captureK6ProcessSnapshot(runRecord, child.pid);
      captureSshTunnelProcessSnapshot(runRecord, tunnel?.child.pid);
      if (error) reject(error);
      else resolve(code ?? 1);
    };
    captureK6ProcessSnapshot(runRecord, child.pid);
    captureSshTunnelProcessSnapshot(runRecord, tunnel?.child.pid);
    processTimer = setInterval(() => {
      captureK6ProcessSnapshot(runRecord, child.pid);
      captureSshTunnelProcessSnapshot(runRecord, tunnel?.child.pid);
    }, 15_000);
    healthTimer = setInterval(async () => {
      if (settled || stopError) return;
      const healthy = await isHealthy(`${WEB_ORIGIN}/api/v1/health`, true);
      if (stopError) return;
      if (healthy && isPostgresReady(project, state)) return;
      terminate(new LoadTestError("The run-owned web or PostgreSQL health check failed during the load scenario."));
    }, 10_000);
    if (signal.aborted) onAbort();
    child.once("error", () => finish(new LoadTestError("The pinned k6 process could not be started.")));
    child.once("close", (code) => finish(stopError, code));
  });
}
