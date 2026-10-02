import { runCompose } from "./docker.mjs";
import { safeComposeEnvironment } from "./environment.mjs";
import { LoadTestError, assertNotAborted } from "./errors.mjs";
import { MAILPIT_ORIGIN, ROOT } from "./settings.mjs";
import { ensurePrivateDirectory, projectDirectory, smtpCertificateFilePath, smtpPrivateKeyFilePath } from "./state.mjs";
import { mailpitMessageListIsEmpty, mailpitPreflightMessageCaptured } from "./validation.mjs";
import { spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

export function startMailpitWithCertificate(project, state) {
  const running = runCompose(project, state, ["ps", "--status", "running", "--services"], { capture: true })
    .split(/\r?\n/)
    .filter(Boolean);
  if (running.includes("mailpit")) return;
  let ids = runCompose(project, state, ["ps", "--all", "--quiet", "mailpit"], { capture: true })
    .split(/\r?\n/)
    .filter(Boolean);
  if (ids.length === 0) {
    runCompose(project, state, ["create", "mailpit"]);
    ids = runCompose(project, state, ["ps", "--all", "--quiet", "mailpit"], { capture: true })
      .split(/\r?\n/)
      .filter(Boolean);
  }
  if (ids.length !== 1 || !/^[0-9a-f]{12,64}$/.test(ids[0]))
    throw new LoadTestError("The run-owned SMTP catcher container could not be identified safely.");
  copySmtpFileToContainer(project, state, smtpCertificateFilePath(project), ids[0], "/smtp-cert.pem");
  copySmtpFileToContainer(project, state, smtpPrivateKeyFilePath(project), ids[0], "/smtp-key.pem");
  runCompose(project, state, ["start", "mailpit"]);
}

function copySmtpFileToContainer(project, state, source, containerId, destination) {
  const directory = projectDirectory(project);
  ensurePrivateDirectory(directory);
  const stagedDirectory = mkdtempSync(path.join(directory, "smtp-stage-"));
  const stagedSource = path.join(stagedDirectory, "material.pem");
  try {
    chmodSync(stagedDirectory, 0o700);
    ensurePrivateDirectory(stagedDirectory);
    writeFileSync(stagedSource, readFileSync(source), { flag: "wx", mode: 0o444 });
    chmodSync(stagedSource, 0o444);
    const result = spawnSync("docker", ["cp", stagedSource, `${containerId}:${destination}`], {
      cwd: ROOT,
      env: safeComposeEnvironment(project, state),
      stdio: "ignore",
    });
    if (result.error || result.status !== 0)
      throw new LoadTestError("Run-owned SMTP TLS material could not be copied into Mailpit securely.");
  } catch (error) {
    if (error instanceof LoadTestError) throw error;
    throw new LoadTestError("Run-owned SMTP TLS material could not be staged securely for Mailpit.");
  } finally {
    rmSync(stagedDirectory, { recursive: true, force: true });
  }
}

export async function verifySmtpPreflight(project, state, signal) {
  const recipient = "smtp-preflight@loadtest.invalid";
  try {
    await clearMailpitMessages(signal);
    runCompose(project, state, ["exec", "--no-TTY", "api", "bun", "scripts/load-test-smtp-preflight.mjs"], {
      timeout: 20_000,
    });
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      assertNotAborted(signal);
      const response = await fetch(`${MAILPIT_ORIGIN}/api/v1/messages?start=0&limit=10`, {
        signal: AbortSignal.timeout(3_000),
      });
      if (!response.ok) throw new LoadTestError("Run-owned SMTP capture preflight failed.");
      const messageList = await response.json();
      if (mailpitPreflightMessageCaptured(messageList, recipient)) break;
      await delay(250);
    }
    const response = await fetch(`${MAILPIT_ORIGIN}/api/v1/messages?start=0&limit=10`, {
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok || !mailpitPreflightMessageCaptured(await response.json(), recipient))
      throw new LoadTestError("Run-owned SMTP delivery preflight failed.");
  } catch {
    throw new LoadTestError("Run-owned SMTP delivery preflight failed.");
  } finally {
    await clearMailpitMessages(signal).catch(() => undefined);
  }
  await assertMailpitMailboxEmpty(signal);
}

async function clearMailpitMessages(signal) {
  const response = await fetch(`${MAILPIT_ORIGIN}/api/v1/messages`, {
    method: "DELETE",
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new LoadTestError("Run-owned SMTP capture could not be cleared.");
  assertNotAborted(signal);
}

async function assertMailpitMailboxEmpty(signal) {
  const response = await fetch(`${MAILPIT_ORIGIN}/api/v1/messages?start=0&limit=10`, {
    signal: AbortSignal.timeout(3_000),
  });
  if (!response.ok || !mailpitMessageListIsEmpty(await response.json()))
    throw new LoadTestError("Run-owned SMTP capture cleanup could not be verified.");
  assertNotAborted(signal);
}
