import { LoadTestError } from "./errors.mjs";
import { migrate } from "./migration.mjs";
import { bringUp, createProject } from "./projects.mjs";
import { runScenario } from "./scenario.mjs";
import { ALL_NON_CAPACITY_SCENARIO_CASES, DATABASE_NAME, WEB_ORIGIN } from "./settings.mjs";
import { stopProject } from "./teardown.mjs";
import { parseArguments } from "./validation.mjs";

function printHelp() {
  console.log(`Self-hosted k6 load-test runner (web origin is fixed to ${WEB_ORIGIN}).

Default:
  pnpm run loadtest                     Runs all ${ALL_NON_CAPACITY_SCENARIO_CASES.length} non-capacity cases; each gets a fresh generated project and database.

Commands:
  pnpm loadtest all
  pnpm loadtest new --target ${WEB_ORIGIN}
  pnpm loadtest up --project <run-id> --target ${WEB_ORIGIN}
  pnpm loadtest migrate --project <run-id> --target ${WEB_ORIGIN} --confirm-migration <run-id>/${DATABASE_NAME} [--preserve-on-failure]
  pnpm loadtest run --project <run-id> --target ${WEB_ORIGIN} --scenario <name>
  pnpm loadtest down --project <run-id> --target ${WEB_ORIGIN}

Scenarios: returning-personal, account-mutations, browser-smoke, first-time, shared-vault, shared-account-mutations, rate-limits, capacity.
Rate-limit boundaries: add --boundary email|network|authenticated; each boundary gets its own fresh disposable project and database.
Capacity is not included in the default all run. It requires --max-vus <11-100>, --confirm-high-vus <exact-ceiling>, and --duration <integer>s|<integer>m (1s-10m). Above 20 VUs, capacity reads reuse at most 20 distinct synthetic sessions; no auth or rate-limit bypass is used. Run-owned disposable database operations require a local Docker context and use the recorded capped-local-v4 Compose resource profile. Same-machine capacity is a capped local characterization, not a separate-host or general capacity claim.
Remote SSH Docker contexts are not accepted for disposable database operations under the current repository scope policy.
The all command stops on the first failed case. Migration and scenario failures tear down only the exact run project by default. Use --preserve-on-failure to retain a failed migration/stack/scenario explicitly; use --keep-stack to retain a completed run.
`);
}

async function runAllScenarios() {
  console.log(`all-scenarios=starting cases=${ALL_NON_CAPACITY_SCENARIO_CASES.length} target=${WEB_ORIGIN}`);
  for (const scenarioCase of ALL_NON_CAPACITY_SCENARIO_CASES) {
    const boundary = scenarioCase.boundary ? ` boundary=${scenarioCase.boundary}` : "";
    console.log(`all-case=starting scenario=${scenarioCase.scenario}${boundary}`);
    const project = await createProject({ target: WEB_ORIGIN });
    await bringUp({ project, target: WEB_ORIGIN });
    await migrate({
      project,
      target: WEB_ORIGIN,
      "confirm-migration": `${project}/${DATABASE_NAME}`,
    });
    await runScenario({ project, target: WEB_ORIGIN, ...scenarioCase });
    console.log(`all-case=passed scenario=${scenarioCase.scenario}${boundary} project=${project}`);
  }
  console.log(`all-scenarios=passed cases=${ALL_NON_CAPACITY_SCENARIO_CASES.length}`);
}

export async function main() {
  const { command, options } = parseArguments(process.argv.slice(2));
  if (command === "help") return printHelp();
  if (command === "all") {
    if (Object.keys(options).length > 0)
      throw new LoadTestError("The default all-scenario command does not accept options.");
    return runAllScenarios();
  }
  if (command === "new") return createProject(options);
  if (command === "up") return bringUp(options);
  if (command === "migrate") return migrate(options);
  if (command === "run") return runScenario(options);
  if (command === "down") return stopProject(options);
  throw new LoadTestError("Unknown load-test command.");
}
