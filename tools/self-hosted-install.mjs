import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const usage = "Usage: pnpm selfhosted:install [--interactive]";

export function createSelfHostedInstallSteps(args = []) {
  if (args.length > 1 || (args.length === 1 && args[0] !== "--interactive")) {
    throw new Error(usage);
  }

  const configureArguments = args[0] === "--interactive" ? ["--interactive"] : [];
  return [
    {
      command: "pnpm selfhosted:configure",
      label: "Configure the self-hosted environment",
      script: "tools/self-hosted-configure.mjs",
      args: configureArguments,
    },
    {
      command: "pnpm selfhosted:setup",
      label: "Set up Docker and apply database migrations",
      script: "tools/self-hosted.mjs",
      args: ["setup"],
    },
    {
      command: "pnpm selfhosted:up",
      label: "Build and start the self-hosted services",
      script: "tools/self-hosted.mjs",
      args: ["up"],
    },
  ];
}

export async function runSelfHostedInstall({ args = [], root = repositoryRoot, runStep = runNodeScript } = {}) {
  let steps;
  try {
    steps = createSelfHostedInstallSteps(args);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }

  for (const [index, step] of steps.entries()) {
    console.log(`\n[${index + 1}/${steps.length}] ${step.label}`);
    let exitCode;
    try {
      exitCode = await runStep(step, root);
    } catch (error) {
      console.error(`${step.command} could not start: ${error instanceof Error ? error.message : String(error)}`);
      return 1;
    }

    if (exitCode !== 0) {
      console.error(`${step.command} failed with exit code ${exitCode}. Stopping the install.`);
      return exitCode ?? 1;
    }
  }

  console.log("\nSelf-hosted install complete.");
  return 0;
}

function runNodeScript(step, root) {
  return new Promise((resolveExitCode, reject) => {
    const child = spawn(process.execPath, [resolve(root, step.script), ...step.args], {
      cwd: root,
      stdio: "inherit",
    });

    child.once("error", reject);
    child.once("close", (exitCode, signal) => resolveExitCode(exitCode ?? signalExitCode(signal)));
  });
}

function signalExitCode(signal) {
  if (signal === "SIGINT") return 130;
  if (signal === "SIGTERM") return 143;
  return 1;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = await runSelfHostedInstall({ args: process.argv.slice(2) });
}
