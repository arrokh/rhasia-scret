import {
  assertDockerContextMatches,
  composeArguments,
  runCompose,
  verifyDisposableDatabaseOperation,
} from "./docker.mjs";
import { safeComposeEnvironment } from "./environment.mjs";
import { LoadTestError } from "./errors.mjs";
import { DATABASE_NAME, MAX_MIGRATION_STATS_SAMPLES, ROOT } from "./settings.mjs";
import { readState, writeState } from "./state.mjs";
import { teardown } from "./teardown.mjs";
import {
  parseMigrationDockerStats,
  requiredOption,
  shouldPreserveFailedRun,
  validateMigrationConfirmation,
  validateProject,
  validateRunnerPlacementOption,
  validateTarget,
} from "./validation.mjs";
import { spawn, spawnSync } from "node:child_process";

function captureMigrationDockerStats(project, state) {
  const environment = safeComposeEnvironment(project, state);
  const containers = spawnSync(
    "docker",
    [
      "ps",
      "-q",
      "--filter",
      `label=com.docker.compose.project=${project}`,
      "--filter",
      "label=com.docker.compose.service=migrate",
    ],
    { encoding: "utf8", env: environment, stdio: ["ignore", "pipe", "ignore"] },
  );
  if (containers.error || containers.status !== 0) return [];
  const ids = (containers.stdout ?? "").trim().split(/\r?\n/).filter(Boolean);
  if (ids.length !== 1 || !/^[0-9a-f]{12,64}$/.test(ids[0])) return [];
  const result = spawnSync(
    "docker",
    ["stats", "--no-stream", "--format", "{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}", ids[0]],
    { encoding: "utf8", env: environment, stdio: ["ignore", "pipe", "ignore"] },
  );
  if (result.error || result.status !== 0) return [];
  return parseMigrationDockerStats(result.stdout ?? "", project);
}

function runMigrationWithStatsSampling(project, state) {
  const peak = { sampleCount: 0, maxCpuPercentValue: -1, cpuPercent: null, maxMemoryMiB: -1, memoryUsage: null };
  let sampling = false;
  const sample = () => {
    if (sampling || peak.sampleCount >= MAX_MIGRATION_STATS_SAMPLES) return;
    sampling = true;
    try {
      for (const row of captureMigrationDockerStats(project, state)) {
        peak.sampleCount += 1;
        if (row.cpuPercentValue > peak.maxCpuPercentValue) {
          peak.maxCpuPercentValue = row.cpuPercentValue;
          peak.cpuPercent = row.cpuPercent;
        }
        if (row.memoryMiB > peak.maxMemoryMiB) {
          peak.maxMemoryMiB = row.memoryMiB;
          peak.memoryUsage = row.memoryUsage;
        }
      }
    } catch {
      return;
    } finally {
      sampling = false;
    }
  };
  return new Promise((resolve, reject) => {
    const child = spawn("docker", composeArguments(project, state, ["run", "--build", "--rm", "migrate"]), {
      cwd: ROOT,
      env: safeComposeEnvironment(project, state),
      stdio: "ignore",
    });
    const interval = setInterval(sample, 250);
    let settled = false;
    const finish = (error, code) => {
      if (settled) return;
      settled = true;
      clearInterval(interval);
      sample();
      if (error) {
        reject(error);
        return;
      }
      if (code !== 0) {
        reject(new LoadTestError("Docker Compose operation failed (run)."));
        return;
      }
      resolve(
        peak.sampleCount > 0
          ? { sampleCount: peak.sampleCount, cpuPercent: peak.cpuPercent, memoryUsage: peak.memoryUsage }
          : null,
      );
    };
    child.once("error", () => finish(new LoadTestError("The isolated migration container could not start.")));
    child.once("close", (code) => finish(null, code ?? 1));
    sample();
  });
}

export async function migrate(options) {
  const project = validateProject(requiredOption(options, "project"));
  const target = validateTarget(requiredOption(options, "target"));
  const confirmation = requiredOption(options, "confirm-migration");
  validateMigrationConfirmation(project, DATABASE_NAME, confirmation);
  const state = readState(project);
  validateRunnerPlacementOption(options, state);
  if (target !== state.target) throw new LoadTestError("The target does not match this run's Compose project.");
  assertDockerContextMatches(state);
  if (state.migrationCompleted) throw new LoadTestError("This fresh disposable database has already been migrated.");
  const services = runCompose(project, state, ["ps", "--status", "running", "--services"], { capture: true })
    .split(/\r?\n/)
    .filter(Boolean);
  if (!services.includes("db"))
    throw new LoadTestError("The exact run-owned PostgreSQL service must be running first.");
  verifyDisposableDatabaseOperation(project, state, "test:loadtest-migration");
  try {
    state.migrationDockerPeak = await runMigrationWithStatsSampling(project, state);
    state.migrationCompleted = true;
    state.migratedAt = new Date().toISOString();
    writeState(project, state);
  } catch (error) {
    if (!shouldPreserveFailedRun(options)) await teardown(project, state);
    throw error;
  }
  console.log(`migration=complete`);
  console.log(`database=${confirmation}`);
}
