import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { resolveBrowserTestPort } from "./browser-test-ports";

async function main(): Promise<void> {
  const suiteName = process.argv[2];
  const suite =
    suiteName === "smoke"
      ? { config: "playwright.config.ts", portOffset: 0, distDir: ".next/browser-smoke" }
      : suiteName === "e2e"
        ? { config: "playwright.e2e.config.ts", portOffset: 1, distDir: ".next/browser-e2e" }
        : null;

  if (!suite) {
    console.error("Usage: tsx scripts/run-browser-suite.ts <smoke|e2e>");
    process.exitCode = 2;
    return;
  }

  const basePort = await resolveBrowserTestPort();
  const port = basePort + suite.portOffset;
  const distDir = suite.distDir;
  const absoluteDistDir = resolve(process.cwd(), distDir);
  const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const suiteWorkers =
    suiteName === "smoke" ? process.env.PLAYWRIGHT_SMOKE_WORKERS?.trim() : process.env.PLAYWRIGHT_E2E_WORKERS?.trim();
  rmSync(absoluteDistDir, { recursive: true, force: true });
  const child = spawn(
    command,
    ["exec", "playwright", "test", "--config", suite.config, "--max-failures=1", ...process.argv.slice(3)],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        BROWSER_TEST_PORT: String(port),
        NEXT_DIST_DIR: distDir,
        ...(suiteWorkers ? { PLAYWRIGHT_WORKERS: suiteWorkers } : {}),
      },
      stdio: "inherit",
      detached: process.platform !== "win32",
    },
  );

  let cleaned = false;
  function cleanDistDir(): void {
    if (cleaned) return;
    cleaned = true;
    rmSync(absoluteDistDir, { recursive: true, force: true });
  }

  function stopOnSignal(signal: NodeJS.Signals): void {
    signalChild(signal);
    cleanDistDir();
    process.exit(128 + signalNumber(signal));
  }

  process.once("SIGINT", () => stopOnSignal("SIGINT"));
  process.once("SIGTERM", () => stopOnSignal("SIGTERM"));

  child.once("error", (error) => {
    console.error(`[browser-suite:${suiteName}] failed to start: ${error.message}`);
    cleanDistDir();
    process.exitCode = 1;
  });
  child.once("exit", (code, signal) => {
    cleanDistDir();
    if (signal) process.exitCode = 128 + signalNumber(signal);
    else process.exitCode = code ?? 1;
  });

  function signalChild(signal: NodeJS.Signals): void {
    if (process.platform !== "win32" && child.pid) {
      try {
        process.kill(-child.pid, signal);
        return;
      } catch {
        // The child may have already exited while its process group is being cleaned.
      }
    }
    child.kill(signal);
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

function signalNumber(signal: NodeJS.Signals): number {
  return signal === "SIGINT" ? 2 : 15;
}
