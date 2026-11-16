import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const workingDirectory = process.cwd();
const repositoryRoot = existsSync(resolve(workingDirectory, "apps/api/go.mod"))
  ? workingDirectory
  : resolve(workingDirectory, "../..");
const apiRoot = resolve(repositoryRoot, "apps/api");

export async function cleanBrowserE2eUsers(emails?: readonly string[]): Promise<void> {
  if (process.env.COMPOSE_PROJECT_NAME) {
    await run(
      "node",
      [
        "tools/confirm-database-operation.mjs",
        "--disposable-run-id",
        process.env.RHSIA_DISPOSABLE_RUN_ID ?? "",
        "test:browser-e2e-cleanup",
      ],
      repositoryRoot,
      process.env,
      "Browser E2E database scope verification",
    );
  }

  await run(
    "go",
    ["test", "-run", "^TestCleanBrowserE2EUsers$", "-count=1", "./internal/testsupport"],
    apiRoot,
    {
      ...process.env,
      RHSIA_BROWSER_E2E_CLEANUP: "1",
      RHSIA_BROWSER_E2E_CLEANUP_EMAILS: emails?.length ? JSON.stringify(emails) : "",
    },
    "Browser E2E cleanup",
  );
}

function run(
  command: string,
  arguments_: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  description: string,
): Promise<void> {
  const child = spawn(command, arguments_, { cwd, env, stdio: "inherit" });
  return new Promise<void>((resolvePromise, reject) => {
    child.once("error", () => reject(new Error(`${description} could not start.`)));
    child.once("exit", (code, signal) => {
      if (code === 0) return resolvePromise();
      reject(new Error(`${description} failed (${code ?? signal ?? "unknown"}).`));
    });
  });
}
