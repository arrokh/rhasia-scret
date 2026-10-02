import {
  assertDockerContextMatches,
  inspectDockerContext,
  runCompose,
  verifyDisposableDatabaseOperation,
} from "./docker.mjs";
import { createDisposableRunId } from "./environment.mjs";
import { LoadTestError, assertNotAborted, createCancellation } from "./errors.mjs";
import { startMailpitWithCertificate, verifySmtpPreflight } from "./mailpit.mjs";
import { startRunnerTunnel, stopRunnerTunnel, waitForBootstrapServices, waitForServices } from "./network.mjs";
import { DATABASE_NAME, K6_VERSION, LOADTEST_RESOURCE_PROFILE, PROJECT_PREFIX, WEB_ORIGIN } from "./settings.mjs";
import {
  createSmtpTlsMaterial,
  envFilePath,
  generateEnvironment,
  gitCommit,
  gitWorkingTreeClean,
  projectDirectory,
  readState,
  stateFilePath,
} from "./state.mjs";
import { discardUnstartedProject, teardown } from "./teardown.mjs";
import {
  requiredOption,
  validateProject,
  validateRunnerPlacement,
  validateRunnerPlacementOption,
  validateTarget,
} from "./validation.mjs";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";

export async function createProject(options) {
  validateTarget(requiredOption(options, "target"));
  const context = inspectDockerContext();
  const runnerPlacement = validateRunnerPlacement(
    options["runner-placement"] ?? "same-machine",
    context,
    options["confirm-target"],
  );
  if (context.placement !== "same-machine")
    throw new LoadTestError("Run-owned disposable load-test databases require a local Docker context.");
  const project = `${PROJECT_PREFIX}${createDisposableRunId(context.name)}`;
  const commit = gitCommit();
  const directory = projectDirectory(project);
  mkdirSync(directory, { mode: 0o700 });
  try {
    chmodSync(directory, 0o700);
    const smtpTls = createSmtpTlsMaterial(project);
    const envFile = envFilePath(project);
    writeFileSync(envFile, generateEnvironment(project, commit, smtpTls.caBase64), { flag: "wx", mode: 0o600 });
    chmodSync(envFile, 0o600);
    const state = {
      project,
      target: WEB_ORIGIN,
      databaseName: DATABASE_NAME,
      commit,
      workingTreeCleanAtCreate: gitWorkingTreeClean(),
      k6Version: K6_VERSION,
      runnerPlacement,
      resourceProfile: LOADTEST_RESOURCE_PROFILE,
      dockerContext: context.name,
      dockerContextFingerprint: context.fingerprint,
      migrationCompleted: false,
      migrationDockerPeak: null,
      createdAt: new Date().toISOString(),
    };
    writeFileSync(stateFilePath(project), `${JSON.stringify(state, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    chmodSync(stateFilePath(project), 0o600);
    console.log(`project=${project}`);
    console.log(`target=${WEB_ORIGIN}`);
    console.log(`runner-placement=${runnerPlacement}`);
    console.log(`docker-context=${context.name}`);
    console.log(`migration-confirmation=${project}/${DATABASE_NAME}`);
    console.log("Run credentials are stored outside the repository with owner-only permissions.");
    return project;
  } catch (error) {
    try {
      rmSync(directory, { recursive: true, force: true });
    } catch {
      throw new LoadTestError(`Run project ${project} setup failed and its private state could not be removed.`);
    }
    if (error instanceof LoadTestError) throw error;
    throw new LoadTestError("Run-owned private state could not be initialized safely.");
  }
}

export async function bringUp(options) {
  const project = validateProject(requiredOption(options, "project"));
  const target = validateTarget(requiredOption(options, "target"));
  const state = readState(project);
  validateRunnerPlacementOption(options, state);
  if (target !== state.target) throw new LoadTestError("The target does not match this run's Compose project.");
  assertDockerContextMatches(state);
  verifyDisposableDatabaseOperation(project, state, "test:loadtest-stack-create");
  let tunnel = null;
  let databaseStarted = false;
  const cancellation = createCancellation(() => stopRunnerTunnel(tunnel));
  try {
    tunnel = await startRunnerTunnel(state, cancellation.signal);
    assertNotAborted(cancellation.signal);
    runCompose(project, state, ["up", "--detach", "db"]);
    databaseStarted = true;
    verifyDisposableDatabaseOperation(project, state, "test:loadtest-stack");
    assertNotAborted(cancellation.signal);
    startMailpitWithCertificate(project, state);
    assertNotAborted(cancellation.signal);
    await waitForBootstrapServices(project, state, tunnel, cancellation.signal);
    runCompose(project, state, ["build", "api", "web", "retention-purge"]);
    runCompose(project, state, ["up", "--detach", "--no-build", "--pull", "never", "api", "web", "retention-purge"]);
    assertNotAborted(cancellation.signal);
    await waitForServices(project, state, tunnel, cancellation.signal);
    await verifySmtpPreflight(project, state, cancellation.signal);
    console.log("smtp-preflight=passed");
  } catch (error) {
    if (!options["preserve-on-failure"] && !options["keep-stack"]) {
      if (databaseStarted) {
        await teardown(project, state);
      } else {
        try {
          discardUnstartedProject(project, state);
        } catch {
          throw new LoadTestError(
            "Stack startup failed before PostgreSQL verification; run-owned resources were retained for safe inspection.",
          );
        }
      }
    }
    throw error;
  } finally {
    stopRunnerTunnel(tunnel);
    cancellation.dispose();
  }
  console.log(`ready=${target}`);
  console.log(`project=${project}`);
  console.log(`migration-required=${project}/${DATABASE_NAME}`);
}
