import { cleanHostEnvironment } from "./environment.mjs";
import { LoadTestError } from "./errors.mjs";
import {
  DATABASE_NAME,
  K6_VERSION,
  LOADTEST_RESOURCE_PROFILE,
  LOADTEST_SERVICE_RESOURCE_LIMITS,
  ROOT,
  WEB_ORIGIN,
} from "./settings.mjs";
import { isValidMigrationDockerPeak, validateProject } from "./validation.mjs";
import { randomBytes, X509Certificate } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export function gitWorkingTreeClean() {
  const result = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], {
    cwd: ROOT,
    encoding: "utf8",
    env: cleanHostEnvironment(),
    stdio: ["ignore", "pipe", "ignore"],
  });
  return result.status === 0 && (result.stdout ?? "").length === 0;
}

export function gitCommit() {
  const result = spawnSync("git", ["rev-parse", "--short=12", "HEAD"], {
    cwd: ROOT,
    encoding: "utf8",
    env: cleanHostEnvironment(),
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.status !== 0 || !/^[0-9a-f]{7,12}\n?$/.test(result.stdout ?? ""))
    throw new LoadTestError("Unable to identify the current Git commit.");
  return result.stdout.trim();
}

export function projectDirectory(project) {
  return path.join(os.tmpdir(), `rhasia-loadtest-${validateProject(project)}`);
}

export function envFilePath(project) {
  return path.join(projectDirectory(project), "compose.env");
}

export function stateFilePath(project) {
  return path.join(projectDirectory(project), "state.json");
}

export function smtpCertificateFilePath(project) {
  return path.join(projectDirectory(project), "smtp-cert.pem");
}

export function smtpPrivateKeyFilePath(project) {
  return path.join(projectDirectory(project), "smtp-key.pem");
}

export function createSmtpTlsMaterial(project) {
  const certificatePath = smtpCertificateFilePath(project);
  const privateKeyPath = smtpPrivateKeyFilePath(project);
  const result = spawnSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-sha256",
      "-days",
      "30",
      "-subj",
      "/CN=mailpit",
      "-keyout",
      privateKeyPath,
      "-out",
      certificatePath,
      "-addext",
      "basicConstraints=critical,CA:TRUE",
      "-addext",
      "keyUsage=critical,digitalSignature,keyEncipherment,keyCertSign",
      "-addext",
      "extendedKeyUsage=serverAuth",
      "-addext",
      "subjectAltName=DNS:mailpit",
    ],
    { cwd: ROOT, env: cleanHostEnvironment(), stdio: "ignore", timeout: 15_000 },
  );
  if (result.error || result.status !== 0)
    throw new LoadTestError("OpenSSL is required to create the run-owned SMTP TLS certificate.");
  try {
    chmodSync(certificatePath, 0o600);
    chmodSync(privateKeyPath, 0o600);
    const certificate = new X509Certificate(readFileSync(certificatePath));
    if (!certificate.ca || !certificate.checkHost("mailpit")) throw new Error("invalid-smtp-certificate");
    return {
      certificatePath,
      privateKeyPath,
      caBase64: readFileSync(certificatePath).toString("base64"),
    };
  } catch {
    rmSync(certificatePath, { force: true });
    rmSync(privateKeyPath, { force: true });
    throw new LoadTestError("The run-owned SMTP TLS certificate could not be verified safely.");
  }
}

export function ensurePrivateDirectory(directory) {
  const details = lstatSync(directory);
  if (!details.isDirectory() || details.isSymbolicLink() || (details.mode & 0o077) !== 0)
    throw new LoadTestError("Run state directory is not private and regular.");
  if (typeof process.getuid === "function" && details.uid !== process.getuid())
    throw new LoadTestError("Run state directory is not owned by the current user.");
}

export function readState(project) {
  const directory = projectDirectory(project);
  if (
    !existsSync(directory) ||
    !existsSync(stateFilePath(project)) ||
    !existsSync(envFilePath(project)) ||
    !existsSync(smtpCertificateFilePath(project)) ||
    !existsSync(smtpPrivateKeyFilePath(project))
  )
    throw new LoadTestError("Run state is missing; create a new run project first.");
  ensurePrivateDirectory(directory);
  for (const filePath of [
    stateFilePath(project),
    envFilePath(project),
    smtpCertificateFilePath(project),
    smtpPrivateKeyFilePath(project),
  ]) {
    const details = lstatSync(filePath);
    if (!details.isFile() || details.isSymbolicLink() || (details.mode & 0o077) !== 0)
      throw new LoadTestError("Run state file is not private and regular.");
    if (typeof process.getuid === "function" && details.uid !== process.getuid())
      throw new LoadTestError("Run state file is not owned by the current user.");
  }
  let state;
  try {
    state = JSON.parse(readFileSync(stateFilePath(project), "utf8"));
  } catch {
    throw new LoadTestError("Run state metadata is invalid.");
  }
  if (
    state.project !== project ||
    state.databaseName !== DATABASE_NAME ||
    state.target !== WEB_ORIGIN ||
    typeof state.commit !== "string" ||
    !/^[0-9a-f]{7,12}$/.test(state.commit) ||
    state.k6Version !== K6_VERSION ||
    state.resourceProfile !== LOADTEST_RESOURCE_PROFILE ||
    !isValidMigrationDockerPeak(state.migrationDockerPeak) ||
    typeof state.workingTreeCleanAtCreate !== "boolean" ||
    !["same-machine", "separate-runner"].includes(state.runnerPlacement) ||
    typeof state.dockerContext !== "string" ||
    !/^[A-Za-z0-9._-]{1,64}$/.test(state.dockerContext) ||
    typeof state.dockerContextFingerprint !== "string" ||
    !/^[0-9a-f]{64}$/.test(state.dockerContextFingerprint)
  )
    throw new LoadTestError("Run state does not match the explicitly confirmed project, target, and Docker context.");
  return state;
}

export function writeState(project, state) {
  const filePath = stateFilePath(project);
  const temporary = `${filePath}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  chmodSync(temporary, 0o600);
  rmSync(filePath, { force: true });
  writeFileSync(filePath, readFileSync(temporary), { flag: "wx", mode: 0o600 });
  rmSync(temporary, { force: true });
}

export function generateEnvironment(project, commit, smtpCaBase64) {
  const databasePassword = randomBytes(32).toString("hex");
  const proxySecret = randomBytes(32).toString("hex");
  const magicLinkSecret = randomBytes(48).toString("hex");
  let sessionSecret = randomBytes(48).toString("hex");
  while (sessionSecret === magicLinkSecret) sessionSecret = randomBytes(48).toString("hex");
  const cronSecret = randomBytes(32).toString("hex");
  const smtpPassword = randomBytes(32).toString("hex");
  const lines = [
    `COMMIT_SHA=${commit}`,
    `COMPOSE_PROJECT_NAME=${project}`,
    `POSTGRES_DB=${DATABASE_NAME}`,
    "POSTGRES_USER=loadtest",
    `POSTGRES_PASSWORD=${databasePassword}`,
    `DATABASE_URL=postgresql://loadtest:${databasePassword}@db:5432/${DATABASE_NAME}?schema=public`,
    `DIRECT_URL=postgresql://loadtest:${databasePassword}@db:5432/${DATABASE_NAME}?schema=public`,
    "APP_BIND_ADDRESS=127.0.0.1",
    "APP_PORT=4000",
    "WEB_CONTAINER_PORT=4000",
    "MAILPIT_PORT=8025",
    ...Object.entries(LOADTEST_SERVICE_RESOURCE_LIMITS).flatMap(([service, limits]) => {
      const key = service.toUpperCase().replaceAll("-", "_");
      return [`LOADTEST_${key}_CPUS=${limits.cpus}`, `LOADTEST_${key}_MEMORY=${limits.memory}`];
    }),
    `WEB_ORIGIN=${WEB_ORIGIN}`,
    `AUTH_APP_ORIGIN=${WEB_ORIGIN}`,
    `PROXY_SECRET=${proxySecret}`,
    `API_PROXY_SECRET=${proxySecret}`,
    "AUTH_BACKEND=passwordless",
    `AUTH_MAGIC_LINK_SECRET=${magicLinkSecret}`,
    `AUTH_SESSION_SECRET=${sessionSecret}`,
    "AUTH_TRUST_PROXY_HEADERS=false",
    "AUTH_MAGIC_LINK_TTL_SECONDS=900",
    "AUTH_ACCESS_TOKEN_TTL_SECONDS=3600",
    "AUTH_REFRESH_TOKEN_TTL_SECONDS=3600",
    "TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA",
    "NEXT_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA",
    "SMTP_HOST=mailpit",
    "SMTP_PORT=465",
    "SMTP_SECURE=true",
    "SMTP_REQUIRE_TLS=true",
    `SMTP_TLS_CA=${smtpCaBase64}`,
    "SMTP_USER=loadtest",
    `SMTP_PASSWORD=${smtpPassword}`,
    "AUTH_EMAIL_FROM=no-reply@loadtest.invalid",
    "AUTH_EMAIL_FROM_NAME=rhasia-scret-loadtest",
    `CRON_SECRET=${cronSecret}`,
    "PASSKEY_RP_ID=localhost",
    `PASSKEY_ORIGIN=${WEB_ORIGIN}`,
    "NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN=",
    "NEXT_PUBLIC_POSTHOG_HOST=",
    "NEXT_PUBLIC_CLOUDFLARE_WEB_ANALYTICS_TOKEN=",
  ];
  return `${lines.join("\n")}\n`;
}
