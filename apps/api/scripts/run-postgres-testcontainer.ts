import { randomBytes } from "node:crypto";
import { execFileSync, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import { loadWorkspaceEnvironment } from "./load-workspace-environment";
import { hasDockerConnectionOverride, isLocalDockerContext } from "./docker-context";

const POSTGRES_PORT = 5432;
const POSTGRES_DATABASE = "rhasia_scret_test";
const POSTGRES_USER = "rhasia_test";
const POSTGRES_PASSWORD = "rhasia_test_password";
const CONTAINER_STOP_TIMEOUT_MS = 10_000;
type TerminationSignal = "SIGINT" | "SIGTERM";
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const apiRoot = resolve(repositoryRoot, "apps/api");
const LEGACY_SCHEMA_FIXTURE_PATH = resolve(apiRoot, "db/sqitch/test-fixtures/legacy-prisma-schema.sql");

class LoopbackPostgresContainer extends GenericContainer {
  withLoopbackExposedPort(port: number): this {
    this.withExposedPorts(port);
    this.hostConfig.PortBindings = {
      ...this.hostConfig.PortBindings,
      [`${port}/tcp`]: [{ HostIp: "127.0.0.1", HostPort: "0" }],
    };
    return this;
  }
}

async function main(): Promise<number> {
  const mode = process.argv[2];
  if (mode !== "--integration" && mode !== "--test" && mode !== "--full" && mode !== "--runtime-parity") {
    console.error(
      "Usage: pnpm test:integration:container|test:container|test:full:container|test:runtime-parity:container",
    );
    return 2;
  }
  loadWorkspaceEnvironment();
  assertLocalDockerContext();

  let container: StartedTestContainer | undefined;
  let activeChild: ChildProcess | undefined;
  let terminationSignal: TerminationSignal | undefined;
  let migrationImage: string | undefined;
  let migrationContainer: string | undefined;
  let adoptionMigrationContainer: string | undefined;
  let parityDatabaseNames: string[] = [];
  let containerVolumes: string[] = [];
  const handleTermination = (signal: TerminationSignal) => {
    terminationSignal = signal;
    if (activeChild && activeChild.exitCode === null && activeChild.signalCode === null) {
      activeChild.kill(signal);
    }
  };

  process.on("SIGINT", handleTermination);
  process.on("SIGTERM", handleTermination);

  try {
    const runId = randomBytes(8).toString("hex");
    const imageTag = `rhasia-scret-api-migrate-test:${runId}`;
    migrationImage = imageTag;
    const buildExitCode = await runCommand(
      "docker",
      ["build", "--file", "apps/api/Dockerfile.migration", "--target", "migration", "--tag", imageTag, "."],
      repositoryRoot,
      process.env,
      (child) => {
        activeChild = child;
        if (terminationSignal) child.kill(terminationSignal);
      },
    );
    if (terminationSignal) return 1;
    if (buildExitCode !== 0) return buildExitCode;

    container = await new LoopbackPostgresContainer("postgres:16-alpine")
      .withEnvironment({
        POSTGRES_DB: POSTGRES_DATABASE,
        POSTGRES_USER,
        POSTGRES_PASSWORD,
      })
      .withLoopbackExposedPort(POSTGRES_PORT)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .withStartupTimeout(120_000)
      .start();
    const containerID = container.getId();
    containerVolumes = inspectPostgresVolumes(containerID);
    if (terminationSignal) return 1;

    const connectionString = `postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${container.getHost()}:${container.getMappedPort(POSTGRES_PORT)}/${POSTGRES_DATABASE}?schema=public`;
    const sqitchURL = new URL(connectionString);
    sqitchURL.hostname = "127.0.0.1";
    sqitchURL.port = String(POSTGRES_PORT);
    sqitchURL.searchParams.set("sslmode", "disable");
    const environment = {
      ...process.env,
      DATABASE_URL: connectionString,
      DIRECT_URL: connectionString,
      RHSIA_GO_INTEGRATION_DATABASE_URL: connectionString,
      RHSIA_DISPOSABLE_RUN_ID: runId,
      RHSIA_DISPOSABLE_DATA_CLASSIFICATION: "synthetic",
      RHSIA_TESTCONTAINER_ID: containerID,
      COMPOSE_PROJECT_NAME: "",
      REQUIRE_DATABASE_INTEGRATION: "1",
    };

    migrationContainer = `rhasia-scret-sqitch-${runId}`;
    const migrationExitCode = await runCommand(
      "docker",
      [
        "run",
        "--rm",
        "--name",
        migrationContainer,
        "--label",
        `rhasia.scret.disposable-run-id=${runId}`,
        "--label",
        "rhasia.scret.purpose=sqitch-test",
        "--network",
        `container:${containerID}`,
        "--env",
        "DIRECT_URL",
        imageTag,
      ],
      repositoryRoot,
      { ...process.env, DIRECT_URL: sqitchURL.toString() },
      (child) => {
        activeChild = child;
        if (terminationSignal) child.kill(terminationSignal);
      },
    );
    if (terminationSignal) return 1;
    if (migrationExitCode !== 0) return migrationExitCode;
    verifySqitchRejectsUnexpectedObjects(containerID, migrationContainer, imageTag, sqitchURL.toString(), runId);
    adoptionMigrationContainer = `rhasia-scret-sqitch-adoption-${runId}`;
    verifySqitchLegacyAdoption(containerID, adoptionMigrationContainer, imageTag, sqitchURL.toString(), runId);

    const parityDatabases = createRuntimeParityDatabases(containerID, runId, connectionString, (databaseName) =>
      parityDatabaseNames.push(databaseName),
    );
    parityDatabaseNames = parityDatabases.names;
    const parityEnvironment = {
      ...environment,
      RHSIA_API_PARITY_GO_DATABASE_URL: parityDatabases.goURL,
      RHSIA_API_PARITY_TS_DATABASE_URL: parityDatabases.tsURL,
    };

    const runPackage = (args: string[], cwd: string, childEnvironment = environment) =>
      runCommand(pnpmCommand(), args, cwd, childEnvironment, (child) => {
        activeChild = child;
        if (terminationSignal) child.kill(terminationSignal);
      });
    const runGo = (args: string[]) =>
      runCommand("go", args, apiRoot, environment, (child) => {
        activeChild = child;
        if (terminationSignal) child.kill(terminationSignal);
      });

    const runtimeParityExitCode = await runPackage(
      ["--filter", "@rhasia-scret/api-parity", "run", "test:runtime-parity"],
      repositoryRoot,
      parityEnvironment,
    );
    if (terminationSignal || runtimeParityExitCode !== 0) return terminationSignal ? 1 : runtimeParityExitCode;
    if (mode === "--runtime-parity") return 0;

    if (mode === "--integration") {
      const integrationExitCode = await runPackage(
        ["--filter", "@rhasia-scret/api-parity", "test:integration"],
        repositoryRoot,
      );
      if (terminationSignal || integrationExitCode !== 0) return terminationSignal ? 1 : integrationExitCode;
      const goExitCode = await runGo(["test", "./...", "-count=1"]);
      return goExitCode;
    }

    const prismaGenerationExitCode = await runPackage(
      ["--filter", "@rhasia-scret/api-parity", "run", "test:parity:generate"],
      repositoryRoot,
    );
    if (terminationSignal || prismaGenerationExitCode !== 0) {
      return terminationSignal ? 1 : prismaGenerationExitCode;
    }

    const hostedCommand = mode === "--test" ? "test:hosted" : "test:full:hosted";
    const hostedExitCode = await runPackage(["run", hostedCommand], repositoryRoot);
    return hostedExitCode;
  } finally {
    process.off("SIGINT", handleTermination);
    process.off("SIGTERM", handleTermination);
    if (activeChild && activeChild.exitCode === null && activeChild.signalCode === null) {
      activeChild.kill("SIGTERM");
    }
    const cleanupErrors: string[] = [];
    if (container) {
      for (const databaseName of parityDatabaseNames) {
        try {
          dropRuntimeParityDatabase(container.getId(), databaseName);
        } catch {
          cleanupErrors.push("Run-owned runtime-parity database could not be removed and verified absent.");
        }
      }
      try {
        await stopTestContainer(container, containerVolumes);
      } catch (error: unknown) {
        cleanupErrors.push(error instanceof Error ? error.message : "Disposable database cleanup failed.");
      }
    }
    for (const containerName of [migrationContainer, adoptionMigrationContainer]) {
      if (!containerName) continue;
      try {
        ensureContainerAbsent(containerName);
      } catch (error: unknown) {
        cleanupErrors.push(error instanceof Error ? error.message : "Sqitch migration container cleanup failed.");
      }
    }
    if (migrationImage) {
      try {
        removeMigrationImage(migrationImage);
      } catch (error: unknown) {
        cleanupErrors.push(error instanceof Error ? error.message : "Sqitch test image cleanup failed.");
      }
    }
    if (cleanupErrors.length > 0) throw new Error(cleanupErrors.join(" "));
  }
}

function pnpmCommand(): string {
  return process.platform === "win32" ? "pnpm.cmd" : "pnpm";
}

function runCommand(
  command: string,
  args: string[],
  cwd: string,
  environment: NodeJS.ProcessEnv,
  onStarted?: (child: ChildProcess) => void,
): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, env: environment, stdio: "inherit" });
    onStarted?.(child);
    child.once("error", reject);
    child.once("exit", (code, signal) => resolvePromise(code ?? (signal ? 1 : 0)));
  });
}

function verifySqitchRejectsUnexpectedObjects(
  postgresContainerID: string,
  verifierContainerName: string,
  imageTag: string,
  directURL: string,
  runID: string,
): void {
  const sqlArguments = [
    "exec",
    postgresContainerID,
    "psql",
    "--no-psqlrc",
    "--set",
    "ON_ERROR_STOP=1",
    "--username",
    POSTGRES_USER,
    "--dbname",
    POSTGRES_DATABASE,
    "--command",
  ];
  const createResult = spawnSync(
    "docker",
    [
      ...sqlArguments,
      `BEGIN;
        CREATE SEQUENCE public.synthetic_sqitch_untracked_sequence;
        CREATE VIEW public.synthetic_sqitch_untracked_view AS SELECT 1 AS marker;
        CREATE FUNCTION public.synthetic_sqitch_untracked_trigger() RETURNS trigger
          LANGUAGE plpgsql AS $function$ BEGIN RETURN NEW; END; $function$;
        CREATE TRIGGER synthetic_sqitch_untracked_trigger
          BEFORE INSERT ON public.application_users
          FOR EACH ROW EXECUTE FUNCTION public.synthetic_sqitch_untracked_trigger();
        CREATE POLICY synthetic_sqitch_untracked_policy ON public.application_users USING (true);
      COMMIT;`,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  if (createResult.error || createResult.status !== 0) {
    throw new Error("Could not create synthetic Sqitch verifier objects.");
  }

  const runVerifier = () =>
    spawnSync(
      "docker",
      [
        "run",
        "--rm",
        "--name",
        verifierContainerName,
        "--label",
        `rhasia.scret.disposable-run-id=${runID}`,
        "--label",
        "rhasia.scret.purpose=sqitch-verify-guard-test",
        "--network",
        `container:${postgresContainerID}`,
        "--env",
        "DIRECT_URL",
        imageTag,
        "verify",
      ],
      {
        cwd: repositoryRoot,
        env: { ...process.env, DIRECT_URL: directURL },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

  try {
    const verification = runVerifier();
    const output = `${verification.stdout ?? ""}\n${verification.stderr ?? ""}`;
    if (
      verification.error ||
      verification.status === 0 ||
      !output.includes("Expected 311 schema objects, found 316.")
    ) {
      throw new Error("Sqitch verify did not reject synthetic untracked schema objects.");
    }
    console.info("Sqitch verify rejected synthetic untracked schema objects.");
  } finally {
    const cleanupResult = spawnSync(
      "docker",
      [
        ...sqlArguments,
        `BEGIN;
      DROP POLICY IF EXISTS synthetic_sqitch_untracked_policy ON public.application_users;
      DROP TRIGGER IF EXISTS synthetic_sqitch_untracked_trigger ON public.application_users;
      DROP FUNCTION IF EXISTS public.synthetic_sqitch_untracked_trigger();
      DROP VIEW IF EXISTS public.synthetic_sqitch_untracked_view;
      DROP SEQUENCE IF EXISTS public.synthetic_sqitch_untracked_sequence;
    COMMIT;`,
      ],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    if (cleanupResult.error || cleanupResult.status !== 0) {
      throw new Error("Could not remove synthetic Sqitch verifier objects from the disposable database.");
    }
  }

  const cleanVerification = runVerifier();
  if (cleanVerification.error || cleanVerification.status !== 0) {
    throw new Error("Sqitch verify did not pass after synthetic untracked objects were removed.");
  }
}

function verifySqitchLegacyAdoption(
  postgresContainerID: string,
  migrationContainerName: string,
  imageTag: string,
  baseDirectURL: string,
  runID: string,
): void {
  const legacyDatabase = `rhasia_scret_legacy_${runID}`;
  if (!/^rhasia_scret_legacy_[0-9a-f]{16}$/.test(legacyDatabase)) {
    throw new Error("Synthetic legacy database name is invalid.");
  }

  runPostgresSQL(postgresContainerID, POSTGRES_DATABASE, `CREATE DATABASE ${legacyDatabase};`);
  runPostgresSQL(postgresContainerID, legacyDatabase, "DROP SCHEMA public CASCADE;");
  const legacySchemaFixture = readFileSync(LEGACY_SCHEMA_FIXTURE_PATH, "utf8");
  runPostgresSQL(postgresContainerID, legacyDatabase, undefined, legacySchemaFixture, false, true);

  const freshSchema = dumpPublicSchema(postgresContainerID, POSTGRES_DATABASE);
  const legacySchema = dumpPublicSchema(postgresContainerID, legacyDatabase);
  if (legacySchema !== freshSchema) {
    throw new Error("Synthetic Prisma-era schema does not match the fresh Sqitch init schema.");
  }

  const sentinelID = `legacy-sentinel-${runID}`;
  const sentinelEmail = `legacy-sentinel+${runID}@example.test`;
  runPostgresSQL(
    postgresContainerID,
    legacyDatabase,
    `INSERT INTO public.application_users (id, email, status, updated_at) VALUES ('${sentinelID}', '${sentinelEmail}', 'ACTIVE', CURRENT_TIMESTAMP);`,
  );
  const sentinelQuery = `SELECT id || '|' || email || '|' || status || '|' || count(*)::text FROM public.application_users WHERE id = '${sentinelID}' GROUP BY id, email, status;`;
  const sentinelBefore = runPostgresSQL(postgresContainerID, legacyDatabase, sentinelQuery, undefined, true);
  const userCountBefore = runPostgresSQL(
    postgresContainerID,
    legacyDatabase,
    "SELECT count(*)::text FROM public.application_users;",
    undefined,
    true,
  );
  if (sentinelBefore !== `${sentinelID}|${sentinelEmail}|ACTIVE|1` || userCountBefore !== "1") {
    throw new Error("Synthetic legacy sentinel fixture was not isolated as expected.");
  }
  const schemaBeforeAdoption = dumpPublicSchema(postgresContainerID, legacyDatabase);

  const adoptionURL = new URL(baseDirectURL);
  adoptionURL.pathname = `/${legacyDatabase}`;
  const runMigration = (args: string[]) =>
    spawnSync(
      "docker",
      [
        "run",
        "--rm",
        "--name",
        migrationContainerName,
        "--label",
        `rhasia.scret.disposable-run-id=${runID}`,
        "--label",
        "rhasia.scret.purpose=sqitch-legacy-adoption-test",
        "--network",
        `container:${postgresContainerID}`,
        "--env",
        "DIRECT_URL",
        imageTag,
        ...args,
      ],
      {
        cwd: repositoryRoot,
        env: { ...process.env, DIRECT_URL: adoptionURL.toString() },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

  const registration = runMigration(["deploy", "--log-only", "--to-change", "init"]);
  if (registration.error || registration.status !== 0) {
    throw new Error("Sqitch could not register init against the synthetic legacy schema.");
  }
  const verification = runMigration(["verify"]);
  if (verification.error || verification.status !== 0) {
    throw new Error("Sqitch could not verify the synthetic legacy schema after log-only adoption.");
  }

  const registeredChanges = runPostgresSQL(
    postgresContainerID,
    legacyDatabase,
    "SELECT count(*)::text FROM sqitch.changes WHERE change = 'init';",
    undefined,
    true,
  );
  const sentinelAfter = runPostgresSQL(postgresContainerID, legacyDatabase, sentinelQuery, undefined, true);
  const userCountAfter = runPostgresSQL(
    postgresContainerID,
    legacyDatabase,
    "SELECT count(*)::text FROM public.application_users;",
    undefined,
    true,
  );
  const schemaAfterAdoption = dumpPublicSchema(postgresContainerID, legacyDatabase);
  if (
    registeredChanges !== "1" ||
    sentinelAfter !== sentinelBefore ||
    userCountAfter !== userCountBefore ||
    schemaAfterAdoption !== schemaBeforeAdoption ||
    schemaAfterAdoption !== freshSchema
  ) {
    throw new Error("Sqitch legacy adoption changed the application schema or synthetic sentinel data.");
  }
  console.info(
    "Synthetic legacy schema matched fresh Sqitch init; log-only adoption preserved schema and sentinel rows.",
  );
}

function createRuntimeParityDatabases(
  postgresContainerID: string,
  runID: string,
  templateURL: string,
  recordCreated: (databaseName: string) => void,
): { goURL: string; tsURL: string; names: string[] } {
  if (!/^[0-9a-f]{16}$/.test(runID)) throw new Error("Runtime-parity database run ID is invalid.");
  const names = [`rhasia_scret_parity_go_${runID}`, `rhasia_scret_parity_ts_${runID}`];
  for (const databaseName of names) {
    if (!/^rhasia_scret_parity_(?:go|ts)_[0-9a-f]{16}$/.test(databaseName)) {
      throw new Error("Runtime-parity database name is invalid.");
    }
    const existing = runPostgresSQL(
      postgresContainerID,
      "postgres",
      `SELECT count(*)::text FROM pg_database WHERE datname = '${databaseName}';`,
      undefined,
      true,
    );
    if (existing !== "0") throw new Error("A runtime-parity database already exists for this disposable run.");
    runPostgresSQL(
      postgresContainerID,
      "postgres",
      `CREATE DATABASE ${databaseName} WITH TEMPLATE ${POSTGRES_DATABASE};`,
    );
    recordCreated(databaseName);
  }

  const goURL = new URL(templateURL);
  goURL.pathname = `/${names[0]}`;
  const tsURL = new URL(templateURL);
  tsURL.pathname = `/${names[1]}`;
  return { goURL: goURL.toString(), tsURL: tsURL.toString(), names };
}

function dropRuntimeParityDatabase(postgresContainerID: string, databaseName: string): void {
  if (!/^rhasia_scret_parity_(?:go|ts)_[0-9a-f]{16}$/.test(databaseName)) {
    throw new Error("Refusing to drop a database outside the disposable runtime-parity namespace.");
  }
  runPostgresSQL(postgresContainerID, "postgres", `DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE);`);
  const remaining = runPostgresSQL(
    postgresContainerID,
    "postgres",
    `SELECT count(*)::text FROM pg_database WHERE datname = '${databaseName}';`,
    undefined,
    true,
  );
  if (remaining !== "0") throw new Error("Run-owned runtime-parity database remains after cleanup.");
}

function runPostgresSQL(
  postgresContainerID: string,
  databaseName: string,
  command: string | undefined,
  input?: string,
  tupleOutput = false,
  singleTransaction = false,
): string {
  const args = ["exec"];
  if (input !== undefined) args.push("--interactive");
  args.push(
    postgresContainerID,
    "psql",
    "--no-psqlrc",
    "--set",
    "ON_ERROR_STOP=1",
    "--username",
    POSTGRES_USER,
    "--dbname",
    databaseName,
  );
  if (tupleOutput) args.push("--tuples-only", "--no-align");
  if (singleTransaction) args.push("--single-transaction");
  if (command !== undefined) args.push("--command", command);
  const result = spawnSync("docker", args, {
    input,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) {
    throw new Error("A synthetic PostgreSQL 16 Sqitch adoption check failed.");
  }
  return (result.stdout ?? "").trim();
}

function dumpPublicSchema(postgresContainerID: string, databaseName: string): string {
  const result = spawnSync(
    "docker",
    [
      "exec",
      postgresContainerID,
      "pg_dump",
      "--no-owner",
      "--no-privileges",
      "--schema-only",
      "--schema=public",
      "--exclude-table=public._prisma_migrations",
      "--username",
      POSTGRES_USER,
      "--dbname",
      databaseName,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  if (result.error || result.status !== 0) {
    throw new Error("Could not compare synthetic Sqitch adoption schema dumps.");
  }
  return (result.stdout ?? "")
    .split(/\r?\n/)
    .filter((line) => !/^\\(?:un)?restrict(?:\s|$)/.test(line))
    .join("\n")
    .trimEnd();
}

function assertLocalDockerContext(): void {
  if (hasDockerConnectionOverride(process.env)) {
    throw new Error("Root test wrappers reject Docker daemon override variables; no test database was started.");
  }
  let contexts: unknown;
  try {
    contexts = JSON.parse(execFileSync("docker", ["context", "inspect"], { encoding: "utf8" }));
  } catch {
    throw new Error("Unable to verify the local Docker context; no test database was started.");
  }
  if (!isLocalDockerContext(contexts)) {
    throw new Error("Root test wrappers require a local Docker context; no test database was started.");
  }
  const daemon = spawnSync("docker", ["info"], { encoding: "utf8", stdio: ["ignore", "ignore", "ignore"] });
  if (daemon.error || daemon.status !== 0) {
    throw new Error("The local Docker daemon is unavailable; no test database was started.");
  }
}

function inspectPostgresVolumes(containerID: string): string[] {
  const result = spawnSync("docker", ["inspect", containerID], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.error || result.status !== 0) {
    throw new Error("Could not record the run-owned PostgreSQL container volumes.");
  }
  try {
    const inspected = JSON.parse(result.stdout) as Array<{
      Mounts?: Array<{ Type?: string; Name?: string; Destination?: string }>;
    }>;
    if (inspected.length !== 1) throw new Error("unexpected inspection result");
    const mounts = inspected[0]?.Mounts ?? [];
    if (
      mounts.length !== 1 ||
      mounts[0]?.Type !== "volume" ||
      mounts[0].Destination !== "/var/lib/postgresql/data" ||
      !mounts[0].Name
    ) {
      throw new Error("The disposable PostgreSQL container must use one named data volume and no host mounts.");
    }
    return [mounts[0].Name];
  } catch {
    throw new Error("Could not safely inspect the run-owned PostgreSQL volumes.");
  }
}

async function stopTestContainer(container: StartedTestContainer, volumes: string[]): Promise<void> {
  const containerID = container.getId();
  let recordedVolumes = volumes;
  let volumeInspectionError: unknown;
  if (recordedVolumes.length === 0) {
    try {
      recordedVolumes = inspectPostgresVolumes(containerID);
    } catch (error: unknown) {
      volumeInspectionError = error;
    }
  }
  let stopError: unknown;
  try {
    await container.stop({ timeout: CONTAINER_STOP_TIMEOUT_MS, remove: true, removeVolumes: true });
  } catch (error: unknown) {
    stopError = error;
  }

  const containerAbsent = resourceIsAbsent("container", containerID);
  if (!containerAbsent) removeDockerResource("container", containerID);
  for (const volume of recordedVolumes) {
    if (!resourceIsAbsent("volume", volume)) removeDockerResource("volume", volume);
  }
  const remainingContainers = resourceIsAbsent("container", containerID) ? [] : [containerID];
  const remainingVolumes = recordedVolumes.filter((volume) => !resourceIsAbsent("volume", volume));
  if (volumeInspectionError || stopError || remainingContainers.length > 0 || remainingVolumes.length > 0) {
    const details = [
      volumeInspectionError ? "PostgreSQL volumes could not be recorded" : "",
      stopError ? "Testcontainers stop failed" : "",
      remainingContainers.length ? "PostgreSQL container remains" : "",
      remainingVolumes.length ? "PostgreSQL volume remains" : "",
    ].filter(Boolean);
    throw new Error(`Disposable database cleanup failed: ${details.join("; ")}.`);
  }
  console.info("Disposable PostgreSQL Testcontainer and data volumes removed and verified absent.");
}

function resourceIsAbsent(kind: "container" | "volume" | "image", identifier: string): boolean {
  const args =
    kind === "container"
      ? ["inspect", identifier]
      : kind === "image"
        ? ["image", "inspect", identifier]
        : ["volume", "inspect", identifier];
  const result = spawnSync("docker", args, { encoding: "utf8", stdio: ["ignore", "ignore", "pipe"] });
  if (result.error || result.status === 0) return false;
  const message = (result.stderr ?? "").toLowerCase();
  return ["no such object", "no such container", "no such volume", "no such image"].some((marker) =>
    message.includes(marker),
  );
}

function removeDockerResource(kind: "container" | "volume", identifier: string): void {
  const args = kind === "container" ? ["rm", "--force", "--volumes", identifier] : ["volume", "rm", identifier];
  const result = spawnSync("docker", args, { encoding: "utf8", stdio: ["ignore", "ignore", "ignore"] });
  if (result.error || result.status !== 0) {
    console.error(`Could not remove the run-owned PostgreSQL ${kind}; cleanup will be reported as failed.`);
  }
}

function ensureContainerAbsent(identifier: string): void {
  if (resourceIsAbsent("container", identifier)) return;
  removeDockerResource("container", identifier);
  if (!resourceIsAbsent("container", identifier)) {
    throw new Error("Run-owned Sqitch migration container remains after cleanup.");
  }
  console.info("Run-owned Sqitch migration container removed and verified absent.");
}

function removeMigrationImage(image: string): void {
  if (resourceIsAbsent("image", image)) return;
  const result = spawnSync("docker", ["image", "rm", image], {
    encoding: "utf8",
    stdio: ["ignore", "ignore", "ignore"],
  });
  if (result.error || result.status !== 0) throw new Error("Could not remove the run-owned Sqitch test image.");
  if (!resourceIsAbsent("image", image)) throw new Error("Run-owned Sqitch test image remains after cleanup.");
  console.info("Run-owned Sqitch test image removed and verified absent.");
}

main()
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
