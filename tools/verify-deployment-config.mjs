import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
export const WEB_FORBIDDEN_RUNTIME_ENVIRONMENT_KEYS = [
  "DATABASE_URL",
  "DIRECT_URL",
  "POSTGRES_DB",
  "POSTGRES_USER",
  "POSTGRES_PASSWORD",
  "PROXY_SECRET",
  "AUTH_MAGIC_LINK_SECRET",
  "AUTH_MAGIC_LINK_TTL_SECONDS",
  "AUTH_ACCESS_TOKEN_TTL_SECONDS",
  "AUTH_REFRESH_TOKEN_TTL_SECONDS",
  "TURNSTILE_SECRET_KEY",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_SECURE",
  "SMTP_REQUIRE_TLS",
  "SMTP_USER",
  "SMTP_PASSWORD",
  "AUTH_EMAIL_FROM",
  "AUTH_EMAIL_FROM_NAME",
  "CRON_SECRET",
];

export function createDeploymentConfigVerificationSteps(environment = process.env) {
  const apiEnvironment = { ...environment };
  const webEnvironment = { ...environment };
  for (const name of WEB_FORBIDDEN_RUNTIME_ENVIRONMENT_KEYS) delete webEnvironment[name];

  return [
    {
      label: "API",
      command: "go",
      arguments: ["run", "./cmd/api", "verify-config"],
      directory: "apps/api",
      environment: apiEnvironment,
    },
    {
      label: "Web",
      command: pnpmCommand,
      arguments: ["--filter", "@rhasia-scret/web", "run", "verify:deployment-config"],
      directory: ".",
      environment: webEnvironment,
    },
  ];
}

export function runDeploymentConfigVerification({ root = repositoryRoot, environment = process.env } = {}) {
  for (const step of createDeploymentConfigVerificationSteps(environment)) {
    const result = spawnSync(step.command, step.arguments, {
      cwd: resolve(root, step.directory),
      env: step.environment,
      shell: process.platform === "win32",
      stdio: "inherit",
    });
    if (result.error) {
      console.error(`Failed to start ${step.label} deployment configuration verification: ${result.error.message}`);
      return 1;
    }
    if (result.status !== 0) {
      const exitCode = result.status ?? 1;
      console.error(`${step.label} deployment configuration verification failed with exit code ${exitCode}.`);
      return exitCode;
    }
  }

  return 0;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = runDeploymentConfigVerification();
}
