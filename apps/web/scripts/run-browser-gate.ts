import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { performance } from "node:perf_hooks";

const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const startedAt = performance.now();
const children = new Set<ChildProcess>();
const stages: StageResult[] = [];
const sequentialDevelopmentSuites = process.env.BROWSER_TEST_SEQUENTIAL === "1";
let stopping = false;

process.once("SIGINT", () => {
  terminateChildren();
  process.exitCode = 130;
});
process.once("SIGTERM", () => {
  terminateChildren();
  process.exitCode = 143;
});

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  writeReport("failed", stages);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  let smoke: StageResult;
  let e2e: StageResult;
  if (sequentialDevelopmentSuites) {
    smoke = await runStage("smoke", ["run", "test:browser:smoke"]);
    if (smoke.exitCode !== 0) {
      writeReport("failed", stages);
      process.exitCode = 1;
      return;
    }
    e2e = await runStage("e2e", ["run", "test:browser:e2e"]);
  } else {
    [smoke, e2e] = await Promise.all([
      runStage("smoke", ["run", "test:browser:smoke"]),
      runStage("e2e", ["run", "test:browser:e2e"])
    ]);
  }

  if (smoke.exitCode !== 0 || e2e.exitCode !== 0) {
    writeReport("failed", stages);
    process.exitCode = 1;
    return;
  }

  const pwa = await runStage("pwa", ["run", "test:browser:pwa"]);
  writeReport(pwa.exitCode === 0 ? "passed" : "failed", stages);
  if (pwa.exitCode !== 0) process.exitCode = 1;
}

async function runStage(name: StageResult["name"], args: string[], env: NodeJS.ProcessEnv = process.env): Promise<StageResult> {
  const stageStartedAt = performance.now();
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env,
    stdio: "inherit",
    detached: process.platform !== "win32"
  });
  children.add(child);

  const result = await new Promise<StageResult>((resolveStage) => {
    child.once("error", (error) => resolveStage({ name, exitCode: 1, signal: null, durationMs: elapsed(stageStartedAt), error: error.message }));
    child.once("exit", (exitCode, signal) => resolveStage({ name, exitCode: exitCode ?? 1, signal, durationMs: elapsed(stageStartedAt) }));
  });
  children.delete(child);
  stages.push(result);
  console.log(`[browser-gate] ${name}: ${formatDuration(result.durationMs)} (exit ${result.exitCode})`);
  if (result.exitCode !== 0) terminateChildren();
  return result;
}

function writeReport(status: "passed" | "failed", completedStages: StageResult[]): void {
  const output = resolve(process.env.BROWSER_TEST_RUNTIME_OUTPUT ?? "test-results/performance/test-browser-runtime.json");
  mkdirSync(resolve(output, ".."), { recursive: true });
  writeFileSync(output, `${JSON.stringify({
    schemaVersion: 1,
    status,
    strategy: sequentialDevelopmentSuites
      ? "sequential-dev-suites-then-production-pwa"
      : "parallel-dev-suites-then-production-pwa",
    stages: completedStages.map(({ name, exitCode, signal, durationMs, error }) => ({
      name,
      exitCode,
      signal,
      durationMs: Math.round(durationMs),
      ...(error ? { error } : {})
    })),
    wallClockMs: Math.round(elapsed(startedAt))
  }, null, 2)}\n`);
}

function terminateChildren(): void {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (process.platform !== "win32" && child.pid) {
      try {
        process.kill(-child.pid, "SIGTERM");
        continue;
      } catch {
        // The child may have already exited while its process group is being cleaned.
      }
    }
    child.kill("SIGTERM");
  }
}

function elapsed(start: number): number {
  return performance.now() - start;
}

function formatDuration(durationMs: number): string {
  return `${(durationMs / 1000).toFixed(1)}s`;
}

type StageResult = {
  name: "smoke" | "e2e" | "pwa";
  exitCode: number;
  signal: NodeJS.Signals | null;
  durationMs: number;
  error?: string;
};
