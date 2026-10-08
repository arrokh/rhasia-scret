import { createPublicKey, createPrivateKey, X509Certificate } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PROJECT = "rhasia-scret-dev";
const COMPOSE_FILES = ["docker-compose.yml", "docker-compose.dev.yml"];
const STATE_DIRECTORY = path.join(ROOT, ".local-mailpit");
const CERTIFICATE_PATH = path.join(STATE_DIRECTORY, "smtp-cert.pem");
const PRIVATE_KEY_PATH = path.join(STATE_DIRECTORY, "smtp-key.pem");
const SMTP_USER = "local-dev";
const SMTP_PASSWORD = "local-dev";
const SMTP_PORT = "465";
const DEFAULT_MAILPIT_UI_PORT = "8026";

export function resolveLocalEmailProvider(environment) {
  const provider = environment.LOCAL_EMAIL_PROVIDER?.trim() || "mailpit";
  if (provider === "mailpit" || provider === "smtp") return provider;
  throw new Error("LOCAL_EMAIL_PROVIDER must be either mailpit or smtp.");
}

export function createLocalMailpitSmtpEnvironment(caBase64) {
  return {
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT,
    SMTP_SECURE: "true",
    SMTP_REQUIRE_TLS: "true",
    SMTP_TLS_CA: caBase64,
    SMTP_USER,
    SMTP_PASSWORD,
    AUTH_EMAIL_FROM: "no-reply@example.test",
    AUTH_EMAIL_FROM_NAME: "rhasia-scret-local",
  };
}

export function createConfiguredSmtpEnvironment(environment) {
  return Object.fromEntries(
    [
      "SMTP_HOST",
      "SMTP_PORT",
      "SMTP_SECURE",
      "SMTP_REQUIRE_TLS",
      "SMTP_TLS_CA",
      "SMTP_USER",
      "SMTP_PASSWORD",
      "AUTH_EMAIL_FROM",
      "AUTH_EMAIL_FROM_NAME",
    ].flatMap((name) => (environment[name] === undefined ? [] : [[name, environment[name]]])),
  );
}

export function resolvePublishedMailpitPorts(portBindings) {
  if (!portBindings || typeof portBindings !== "object" || Array.isArray(portBindings))
    throw new Error("Mailpit port bindings could not be verified safely.");
  const uiPort = readLoopbackPort(portBindings, "8025/tcp");
  const smtpPort = readLoopbackPort(portBindings, "465/tcp");
  if (smtpPort !== SMTP_PORT) throw new Error("Mailpit SMTP must remain bound to loopback port 465.");
  return { uiPort };
}

export async function startLocalMailpit(environment = process.env) {
  const composeEnvironment = createComposeEnvironment(environment);
  const handle = { project: PROJECT, environmentFile: path.join(ROOT, ".env"), composeEnvironment };
  const runningServices = compose(handle, ["ps", "--status", "running", "--services"], { capture: true })
    .split(/\r?\n/)
    .filter(Boolean);
  const alreadyRunning = runningServices.includes("mailpit");
  if (alreadyRunning) {
    const containerId = mailpitContainerId(handle);
    const { uiPort } = readPublishedMailpitPorts(handle, containerId);
    await waitForMailpit(uiPort);
    const material = readContainerTlsMaterial(handle, containerId);
    return { smtpEnvironment: createLocalMailpitSmtpEnvironment(material.caBase64), uiPort };
  }

  ensurePrivateDirectory();
  const material = readTlsMaterial() ?? createTlsMaterial();
  handle.composeEnvironment = { ...composeEnvironment, SMTP_TLS_CA: material.caBase64 };
  let containerId;
  let uiPort;
  let runningMaterial;
  try {
    compose(handle, ["create", "mailpit"]);
    containerId = mailpitContainerId(handle);
    copyFileToContainer(handle, CERTIFICATE_PATH, containerId, "/smtp-cert.pem");
    copyFileToContainer(handle, PRIVATE_KEY_PATH, containerId, "/smtp-key.pem");
    compose(handle, ["start", "mailpit"]);
    ({ uiPort } = readPublishedMailpitPorts(handle, containerId));
    await waitForMailpit(uiPort);
    runningMaterial = readContainerTlsMaterial(handle, containerId);
  } catch (error) {
    try {
      compose(handle, ["stop", "mailpit"]);
    } catch {
      // Preserve the startup error if best-effort service cleanup also fails.
    }
    throw error;
  }

  return { smtpEnvironment: createLocalMailpitSmtpEnvironment(runningMaterial.caBase64), uiPort };
}

function createComposeEnvironment(environment) {
  const commit = run("git", ["rev-parse", "--short=12", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  if (!/^[0-9a-f]{7,12}$/.test(commit)) throw new Error("Unable to identify the current source revision.");
  return {
    ...environment,
    COMPOSE_PROJECT_NAME: PROJECT,
    COMMIT_SHA: commit,
    LOCAL_MAILPIT_UI_PORT: readMailpitUiPort(environment.LOCAL_MAILPIT_UI_PORT),
  };
}

function ensurePrivateDirectory() {
  if (!existsSync(STATE_DIRECTORY)) mkdirSync(STATE_DIRECTORY, { mode: 0o700 });
  const details = lstatSync(STATE_DIRECTORY);
  if (
    !details.isDirectory() ||
    details.isSymbolicLink() ||
    (details.mode & 0o077) !== 0 ||
    (typeof process.getuid === "function" && details.uid !== process.getuid())
  ) {
    throw new Error("Local Mailpit state directory must be a private directory owned by this user.");
  }
}

function readTlsMaterial() {
  ensurePrivateDirectory();
  const certificateExists = assertPrivateFile(CERTIFICATE_PATH);
  const privateKeyExists = assertPrivateFile(PRIVATE_KEY_PATH);
  if (!certificateExists && !privateKeyExists) return undefined;
  if (!certificateExists || !privateKeyExists) return undefined;

  try {
    const certificateBytes = readFileSync(CERTIFICATE_PATH);
    const certificate = validateTlsCertificate(certificateBytes);
    if (!certificate) return undefined;
    const privateKey = createPrivateKey(readFileSync(PRIVATE_KEY_PATH));
    const publicFromPrivateKey = createPublicKey(privateKey).export({ type: "spki", format: "der" });
    const publicFromCertificate = certificate.publicKey.export({ type: "spki", format: "der" });
    if (!Buffer.from(publicFromPrivateKey).equals(Buffer.from(publicFromCertificate))) return undefined;
    return { caBase64: certificateBytes.toString("base64") };
  } catch {
    return undefined;
  }
}

function validateTlsCertificate(certificateBytes) {
  try {
    const certificate = new X509Certificate(certificateBytes);
    const validFrom = new Date(certificate.validFrom).getTime();
    const validTo = new Date(certificate.validTo).getTime();
    if (
      !certificate.ca ||
      !certificate.checkHost("mailpit") ||
      !certificate.checkIP("127.0.0.1") ||
      !Number.isFinite(validFrom) ||
      !Number.isFinite(validTo) ||
      Date.now() < validFrom ||
      Date.now() >= validTo
    ) {
      return undefined;
    }
    return certificate;
  } catch {
    return undefined;
  }
}

function assertPrivateFile(filePath) {
  try {
    const details = lstatSync(filePath);
    if (
      !details.isFile() ||
      details.isSymbolicLink() ||
      (details.mode & 0o077) !== 0 ||
      (typeof process.getuid === "function" && details.uid !== process.getuid())
    ) {
      throw new Error("Local Mailpit TLS files must be private regular files owned by this user.");
    }
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

function createTlsMaterial() {
  const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), "rhasia-mailpit-tls-"));
  chmodSync(temporaryDirectory, 0o700);
  const temporaryCertificate = path.join(temporaryDirectory, "smtp-cert.pem");
  const temporaryKey = path.join(temporaryDirectory, "smtp-key.pem");
  try {
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
        "365",
        "-subj",
        "/CN=mailpit",
        "-keyout",
        temporaryKey,
        "-out",
        temporaryCertificate,
        "-addext",
        "basicConstraints=critical,CA:TRUE",
        "-addext",
        "keyUsage=critical,digitalSignature,keyEncipherment,keyCertSign",
        "-addext",
        "extendedKeyUsage=serverAuth",
        "-addext",
        "subjectAltName=DNS:mailpit,DNS:localhost,IP:127.0.0.1",
      ],
      { cwd: ROOT, stdio: "ignore", timeout: 15_000 },
    );
    if (result.error || result.status !== 0) throw new Error("OpenSSL is required to start local Mailpit securely.");

    chmodSync(temporaryCertificate, 0o600);
    chmodSync(temporaryKey, 0o600);
    const certificate = new X509Certificate(readFileSync(temporaryCertificate));
    if (!certificate.ca || !certificate.checkHost("mailpit") || !certificate.checkIP("127.0.0.1"))
      throw new Error("The local Mailpit TLS certificate could not be verified safely.");

    rmSync(CERTIFICATE_PATH, { force: true });
    rmSync(PRIVATE_KEY_PATH, { force: true });
    writeFileSync(CERTIFICATE_PATH, readFileSync(temporaryCertificate), { flag: "wx", mode: 0o600 });
    writeFileSync(PRIVATE_KEY_PATH, readFileSync(temporaryKey), { flag: "wx", mode: 0o600 });
    chmodSync(CERTIFICATE_PATH, 0o600);
    chmodSync(PRIVATE_KEY_PATH, 0o600);
    const material = readTlsMaterial();
    if (!material) throw new Error("The local Mailpit TLS files could not be verified after creation.");
    return material;
  } catch (error) {
    rmSync(CERTIFICATE_PATH, { force: true });
    rmSync(PRIVATE_KEY_PATH, { force: true });
    throw error;
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

function mailpitContainerId(handle) {
  const containerIds = compose(handle, ["ps", "--all", "--quiet", "mailpit"], { capture: true })
    .split(/\r?\n/)
    .filter(Boolean);
  if (containerIds.length !== 1 || !/^[0-9a-f]{12,64}$/.test(containerIds[0]))
    throw new Error("The local Mailpit container could not be identified safely.");
  return containerIds[0];
}

function readPublishedMailpitPorts(handle, containerId) {
  const result = spawnSync("docker", ["inspect", "--format", "{{json .NetworkSettings.Ports}}", containerId], {
    cwd: ROOT,
    env: handle.composeEnvironment,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.error || result.status !== 0) throw new Error("Mailpit port bindings could not be verified safely.");
  try {
    return resolvePublishedMailpitPorts(JSON.parse(result.stdout ?? ""));
  } catch {
    throw new Error("Mailpit port bindings could not be verified safely.");
  }
}

function readLoopbackPort(portBindings, containerPort) {
  const bindings = portBindings[containerPort];
  if (!Array.isArray(bindings) || bindings.length !== 1)
    throw new Error("Mailpit port bindings could not be verified safely.");
  const binding = bindings[0];
  const hostPort = binding?.HostPort;
  if (
    binding?.HostIp !== "127.0.0.1" ||
    typeof hostPort !== "string" ||
    !/^\d+$/.test(hostPort) ||
    Number(hostPort) < 1 ||
    Number(hostPort) > 65_535
  ) {
    throw new Error("Mailpit ports must be bound to loopback.");
  }
  return hostPort;
}

function readContainerTlsMaterial(handle, containerId) {
  const verificationDirectory = mkdtempSync(path.join(os.tmpdir(), "rhasia-mailpit-certificate-"));
  const certificateCopy = path.join(verificationDirectory, "smtp-cert.pem");
  try {
    chmodSync(verificationDirectory, 0o700);
    const result = spawnSync("docker", ["cp", `${containerId}:/smtp-cert.pem`, certificateCopy], {
      cwd: ROOT,
      env: handle.composeEnvironment,
      stdio: "ignore",
    });
    if (result.error || result.status !== 0) throw new Error("certificate copy failed");
    const certificateBytes = readFileSync(certificateCopy);
    if (!validateTlsCertificate(certificateBytes)) throw new Error("certificate validation failed");
    return { caBase64: certificateBytes.toString("base64") };
  } catch {
    throw new Error("The running Mailpit TLS certificate could not be verified safely.");
  } finally {
    rmSync(verificationDirectory, { recursive: true, force: true });
  }
}

function compose(handle, args, { capture = false } = {}) {
  const composeArgs = [
    "compose",
    "--env-file",
    handle.environmentFile ?? path.join(ROOT, ".env"),
    "--project-name",
    handle.project ?? PROJECT,
    ...COMPOSE_FILES.flatMap((file) => ["-f", path.join(ROOT, file)]),
    ...args,
  ];
  const result = spawnSync("docker", composeArgs, {
    cwd: ROOT,
    env: handle.composeEnvironment,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "ignore"] : "ignore",
  });
  if (result.error || result.status !== 0)
    throw new Error(`Local Mailpit Docker Compose ${args[0] ?? "unknown"} operation failed.`);
  return capture ? (result.stdout ?? "").trim() : "";
}

function copyFileToContainer(handle, source, containerId, destination) {
  const stagedDirectory = mkdtempSync(path.join(STATE_DIRECTORY, "stage-"));
  const stagedSource = path.join(stagedDirectory, "material.pem");
  try {
    chmodSync(stagedDirectory, 0o700);
    writeFileSync(stagedSource, readFileSync(source), { flag: "wx", mode: 0o444 });
    chmodSync(stagedSource, 0o444);
    const result = spawnSync("docker", ["cp", stagedSource, `${containerId}:${destination}`], {
      cwd: ROOT,
      env: handle.composeEnvironment,
      stdio: "ignore",
    });
    if (result.error || result.status !== 0) throw new Error("Local Mailpit TLS material could not be copied safely.");
  } finally {
    rmSync(stagedDirectory, { recursive: true, force: true });
  }
}

function readMailpitUiPort(value) {
  const raw = value?.trim() || DEFAULT_MAILPIT_UI_PORT;
  if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 65_535)
    throw new Error("LOCAL_MAILPIT_UI_PORT must be a valid TCP port.");
  return raw;
}

async function waitForMailpit(uiPort) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${uiPort}/`, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
    } catch {
      // The local Mailpit container may still be starting.
    }
    await delay(250);
  }
  throw new Error("Local Mailpit did not become healthy.");
}

function run(command, args, options) {
  const result = spawnSync(command, args, {
    ...options,
    stdio: options?.encoding ? ["ignore", "pipe", "ignore"] : "ignore",
  });
  if (result.error || result.status !== 0) throw new Error("Unable to prepare the local Mailpit service.");
  return result.stdout ?? "";
}

async function main(arguments_) {
  if (arguments_.length !== 1 || arguments_[0] !== "up") {
    console.error("Usage: pnpm dev:mailpit");
    process.exitCode = 1;
    return;
  }
  try {
    process.loadEnvFile(path.join(ROOT, ".env"));
    const { uiPort } = await startLocalMailpit(process.env);
    console.log(`[dev:mailpit] Mailpit is ready at http://localhost:${uiPort}.`);
  } catch (error) {
    console.error(`[dev:mailpit] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main(process.argv.slice(2));
}
