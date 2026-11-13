import { execFileSync, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const allowedOperations = new Set(["deploy", "verify"]);

export function sqitchComposeArguments(operation) {
  if (!allowedOperations.has(operation))
    throw new Error("Choose exactly one supported Sqitch operation: deploy or verify.");
  const command = operation === "deploy" ? ["deploy", "--verify"] : ["verify"];
  return [
    "compose",
    "-f",
    "docker-compose.yml",
    "-f",
    "docker-compose.dev.yml",
    "run",
    "--build",
    "--rm",
    "migrate",
    ...command,
  ];
}

export function runSqitchOperation(
  operation,
  { root = repositoryRoot, run = spawnSync, confirm = runConfirmation } = {},
) {
  if (!allowedOperations.has(operation)) {
    console.error("Choose exactly one supported Sqitch operation: deploy or verify.");
    return 2;
  }
  const projectName = "rhasia-scret-dev";
  const description = `Sqitch ${operation} against the named ${projectName} development database`;
  const confirmation = confirm(description, root);
  if (confirmation !== 0) return confirmation ?? 1;

  let commitSha;
  try {
    commitSha = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    console.error("Could not determine the current source revision; Sqitch was not run.");
    return 1;
  }
  if (!/^[0-9a-f]{7,40}$/u.test(commitSha)) {
    console.error("The current source revision is invalid; Sqitch was not run.");
    return 1;
  }

  const result = run("docker", sqitchComposeArguments(operation), {
    cwd: root,
    env: { ...process.env, COMPOSE_PROJECT_NAME: projectName, COMMIT_SHA: commitSha },
    stdio: "inherit",
  });
  if (result.error) {
    console.error(`Could not start Sqitch ${operation}: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

function runConfirmation(description, root) {
  const result = spawnSync(process.execPath, ["tools/confirm-database-operation.mjs", description], {
    cwd: root,
    stdio: "inherit",
  });
  if (result.error) {
    console.error(`Could not start the database confirmation prompt: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [operation, ...remaining] = process.argv.slice(2);
  if (remaining.length > 0) {
    console.error("Usage: node tools/sqitch-operation.mjs deploy|verify");
    process.exitCode = 2;
  } else {
    process.exitCode = runSqitchOperation(operation);
  }
}
