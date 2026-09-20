import { spawn } from "node:child_process";
import { loadWorkspaceEnvironment } from "./load-workspace-environment";
import { describeDatabaseTarget, requiresDatabaseIntegration } from "./database-test-policy";
import { verifyDatabaseConnection } from "./database-test-preflight";

function runVitest(environment: NodeJS.ProcessEnv, vitestArguments: string[]): Promise<number> {
  const packageManager = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  return new Promise((resolve, reject) => {
    const child = spawn(packageManager, ["exec", "vitest", "run", ...vitestArguments], {
      env: environment,
      stdio: "inherit",
    });

    child.once("error", reject);
    child.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

async function main(): Promise<number> {
  loadWorkspaceEnvironment();
  const runnerArguments = process.argv.slice(2);
  const requireDatabase = runnerArguments.includes("--require-database");
  const vitestArguments = runnerArguments.filter((argument) => argument !== "--require-database");
  const connectionString = process.env.DATABASE_URL?.trim();

  if (!connectionString && (requireDatabase || requiresDatabaseIntegration(process.env))) {
    console.error("Database integration tests require DATABASE_URL.");
    return 1;
  }

  if (connectionString) {
    try {
      await verifyDatabaseConnection(connectionString);
    } catch (error) {
      const target = describeDatabaseTarget(connectionString);
      const message = `Database integration tests cannot reach ${target}.`;

      if (requireDatabase || requiresDatabaseIntegration(process.env)) {
        console.error(`${message} Start the configured PostgreSQL service or fix DATABASE_URL.`);
        console.error(error instanceof Error ? error.message : error);
        return 1;
      }

      console.warn(
        `${message} Running unit and non-database tests only. ` +
          "Set REQUIRE_DATABASE_INTEGRATION=1 to fail instead of skipping database tests.",
      );
      process.env.DATABASE_URL = "";
    }
  }

  return runVitest(process.env, vitestArguments);
}

main()
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
