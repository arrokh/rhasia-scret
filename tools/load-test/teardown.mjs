import { assertDockerContextMatches, runCompose, verifyDisposableDatabaseOperation } from "./docker.mjs";
import { LoadTestError } from "./errors.mjs";
import { projectDirectory, readState } from "./state.mjs";
import { requiredOption, validateProject, validateRunnerPlacementOption, validateTarget } from "./validation.mjs";
import { rmSync } from "node:fs";

export function discardUnstartedProject(project, state) {
  verifyDisposableDatabaseOperation(project, state, "test:loadtest-stack-create");
  rmSync(projectDirectory(project), { recursive: true, force: true });
}

export async function teardown(project, state, { preserve = false } = {}) {
  if (preserve) return;
  assertDockerContextMatches(state);
  try {
    verifyDisposableDatabaseOperation(project, state, "test:loadtest-teardown");
  } catch (error) {
    try {
      discardUnstartedProject(project, state);
      return;
    } catch {
      throw error;
    }
  }
  runCompose(project, state, ["down", "--volumes", "--remove-orphans"]);
  rmSync(projectDirectory(project), { recursive: true, force: true });
}

export async function stopProject(options) {
  const project = validateProject(requiredOption(options, "project"));
  const target = validateTarget(requiredOption(options, "target"));
  const state = readState(project);
  validateRunnerPlacementOption(options, state);
  if (target !== state.target) throw new LoadTestError("The target does not match this run's Compose project.");
  assertDockerContextMatches(state);
  await teardown(project, state);
  console.log(`teardown=complete`);
  console.log(`project=${project}`);
}
