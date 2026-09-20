import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import { loadWorkspaceEnvironment } from "./load-workspace-environment";

const POSTGRES_PORT = 5432;
const POSTGRES_DATABASE = "rhasia_scret_test";
const POSTGRES_USER = "rhasia_test";
const POSTGRES_PASSWORD = "rhasia_test_password";
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const apiRoot = resolve(repositoryRoot, "apps/api");

async function main(): Promise<number> {
  const mode = process.argv[2];
  if (mode !== "--integration" && mode !== "--test" && mode !== "--full") {
    console.error("Usage: pnpm test:integration:container|test:container|test:full:container");
    return 2;
  }
  loadWorkspaceEnvironment();

  let container: StartedTestContainer | undefined;
  try {
    container = await new GenericContainer("postgres:16-alpine")
      .withEnvironment({
        POSTGRES_DB: POSTGRES_DATABASE,
        POSTGRES_USER: POSTGRES_USER,
        POSTGRES_PASSWORD: POSTGRES_PASSWORD,
      })
      .withExposedPorts(POSTGRES_PORT)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/))
      .withStartupTimeout(120_000)
      .start();

    const connectionString = `postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${container.getHost()}:${container.getMappedPort(POSTGRES_PORT)}/${POSTGRES_DATABASE}?schema=public`;
    const environment = {
      ...process.env,
      DATABASE_URL: connectionString,
      DIRECT_URL: connectionString,
      REQUIRE_DATABASE_INTEGRATION: "1",
    };

    await runPackageManager(["run", "prisma:generate"], apiRoot, environment);
    await runPackageManager(["run", "prisma:migrate:deploy"], apiRoot, environment);

    if (mode === "--integration") {
      return await runPackageManager(
        ["--filter", "@rhasia-scret/api", "test:integration"],
        repositoryRoot,
        environment,
      );
    }

    const hostedCommand = mode === "--test" ? "test:hosted" : "test:full:hosted";
    return await runPackageManager(["run", hostedCommand], repositoryRoot, environment);
  } finally {
    if (container) await container.stop();
  }
}

function runPackageManager(args: string[], cwd: string, environment: NodeJS.ProcessEnv): Promise<number> {
  const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, env: environment, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => resolvePromise(code ?? (signal ? 1 : 0)));
  });
}

main()
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
