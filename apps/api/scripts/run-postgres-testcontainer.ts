import { spawn, type ChildProcess } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import { loadWorkspaceEnvironment } from "./load-workspace-environment";

const POSTGRES_PORT = 5432;
const POSTGRES_DATABASE = "rhasia_scret_test";
const POSTGRES_USER = "rhasia_test";
const POSTGRES_PASSWORD = "rhasia_test_password";
const CONTAINER_STOP_TIMEOUT_MS = 10_000;
type TerminationSignal = "SIGINT" | "SIGTERM";
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
  let activeChild: ChildProcess | undefined;
  let terminationSignal: TerminationSignal | undefined;
  const handleTermination = (signal: TerminationSignal) => {
    terminationSignal = signal;
    if (activeChild && activeChild.exitCode === null && activeChild.signalCode === null) {
      activeChild.kill(signal);
    }
  };

  process.on("SIGINT", handleTermination);
  process.on("SIGTERM", handleTermination);

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

    const runCommand = (args: string[], cwd: string) =>
      runPackageManager(args, cwd, environment, (child) => {
        activeChild = child;
        if (terminationSignal) child.kill(terminationSignal);
      });

    const generatedExitCode = await runCommand(["run", "prisma:generate"], apiRoot);
    if (terminationSignal) return 1;
    if (generatedExitCode !== 0) return generatedExitCode;

    const migratedExitCode = await runCommand(["run", "prisma:migrate:deploy"], apiRoot);
    if (terminationSignal) return 1;
    if (migratedExitCode !== 0) return migratedExitCode;

    if (mode === "--integration") {
      const integrationExitCode = await runCommand(
        ["--filter", "@rhasia-scret/api", "test:integration"],
        repositoryRoot,
      );
      return terminationSignal ? 1 : integrationExitCode;
    }

    const hostedCommand = mode === "--test" ? "test:hosted" : "test:full:hosted";
    const hostedExitCode = await runCommand(["run", hostedCommand], repositoryRoot);
    return terminationSignal ? 1 : hostedExitCode;
  } finally {
    process.off("SIGINT", handleTermination);
    process.off("SIGTERM", handleTermination);
    if (activeChild && activeChild.exitCode === null && activeChild.signalCode === null) {
      activeChild.kill("SIGTERM");
    }
    if (container) await stopTestContainer(container);
  }
}

async function stopTestContainer(container: StartedTestContainer): Promise<void> {
  await container.stop({
    timeout: CONTAINER_STOP_TIMEOUT_MS,
    remove: true,
    removeVolumes: true,
  });
}

function runPackageManager(
  args: string[],
  cwd: string,
  environment: NodeJS.ProcessEnv,
  onStarted?: (child: ChildProcess) => void,
): Promise<number> {
  const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, env: environment, stdio: "inherit" });
    onStarted?.(child);
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
