import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { spawn } from "node:child_process";
import process from "node:process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnvFile } from "./self-hosted.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const usage = "Usage: pnpm selfhosted:install [--interactive]";
const supportedTailscaleModes = new Set(["none", "serve", "funnel"]);

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

export function readConfiguredTailscaleMode(root = repositoryRoot) {
  let source;
  try {
    source = readFileSync(resolve(root, ".env"), "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return "none";
    throw new Error("Unable to read the configured Tailscale exposure mode from .env.");
  }

  const mode = parseEnvFile(source).SELF_HOSTED_TAILSCALE_MODE?.trim() || "none";
  if (!supportedTailscaleModes.has(mode)) {
    throw new Error("SELF_HOSTED_TAILSCALE_MODE must be none, serve, or funnel.");
  }
  return mode;
}

export async function confirmPublicFunnel({ input = process.stdin, output = process.stdout, ask } = {}) {
  const prompt =
    "Funnel is public to anyone on the internet. Hosted features still require application sign-in when enabled. Type PUBLIC to enable: ";
  let answer;

  if (ask) {
    answer = await ask(prompt);
  } else {
    if (!input.isTTY || !output.isTTY) {
      throw new Error("Public Funnel activation requires confirmation from an interactive terminal.");
    }

    const readline = createInterface({ input, output });
    try {
      answer = await readline.question(prompt);
    } finally {
      readline.close();
    }
  }

  return typeof answer === "string" && answer.trim() === "PUBLIC";
}

export async function runSelfHostedInstall({
  args = [],
  root = repositoryRoot,
  runStep = runNodeScript,
  readTailscaleMode = readConfiguredTailscaleMode,
  confirmFunnel = confirmPublicFunnel,
} = {}) {
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

  let tailscaleMode;
  try {
    tailscaleMode = readTailscaleMode(root);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  if (tailscaleMode !== "none") {
    const tailscaleStep = {
      command:
        tailscaleMode === "funnel"
          ? "pnpm selfhosted:tailscale funnel --confirm-public"
          : "pnpm selfhosted:tailscale serve",
      label: tailscaleMode === "funnel" ? "Enable public Tailscale Funnel" : "Enable Tailscale Serve",
      script: "tools/self-hosted-tailscale.mjs",
      args: tailscaleMode === "funnel" ? ["funnel", "--confirm-public"] : ["serve"],
    };

    if (tailscaleMode === "funnel") {
      console.log("\n[Tailscale] Confirm public exposure before enabling Funnel.");
      let confirmed;
      try {
        confirmed = await confirmFunnel();
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        console.error("Funnel was not enabled; the self-hosted services remain running.");
        return 1;
      }
      if (!confirmed) {
        console.log("Funnel was not enabled. The self-hosted services remain running.");
        console.log("Self-hosted install complete without public exposure.");
        return 0;
      }
    }

    console.log(`\n[Tailscale] ${tailscaleStep.label}`);
    let exitCode;
    try {
      exitCode = await runStep(tailscaleStep, root);
    } catch (error) {
      console.error(
        `${tailscaleStep.command} could not start: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 1;
    }
    if (exitCode !== 0) {
      console.error(`${tailscaleStep.command} failed with exit code ${exitCode}.`);
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
