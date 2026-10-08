import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createConfiguredSmtpEnvironment,
  createLocalMailpitSmtpEnvironment,
  resolveLocalEmailProvider,
  resolvePublishedMailpitPorts,
  startLocalMailpit,
} from "./local-mailpit.mjs";

test("local Mailpit's temporary directory API is explicitly imported", () => {
  const source = readFileSync(new URL("./local-mailpit.mjs", import.meta.url), "utf8");
  const filesystemImportStart = source.lastIndexOf("import {", source.indexOf('from "node:fs";'));
  const filesystemImport = source.slice(filesystemImportStart, source.indexOf('from "node:fs";'));
  assert.ok(filesystemImport.includes("mkdtempSync"));
});

test("Mailpit container creation avoids unsupported Compose flags", () => {
  const source = readFileSync(new URL("./local-mailpit.mjs", import.meta.url), "utf8");
  assert.ok(source.includes('compose(handle, ["create", "mailpit"])'));
  assert.ok(!source.includes('"create", "--no-deps"'));
  assert.ok(source.includes('`Local Mailpit Docker Compose ${args[0] ?? "unknown"} operation failed.`'));
});

test("running Mailpit reuses its actual UI port and verifies loopback bindings", () => {
  assert.deepEqual(
    resolvePublishedMailpitPorts({
      "8025/tcp": [{ HostIp: "127.0.0.1", HostPort: "18026" }],
      "465/tcp": [{ HostIp: "127.0.0.1", HostPort: "465" }],
    }),
    { uiPort: "18026" },
  );
  assert.throws(
    () =>
      resolvePublishedMailpitPorts({
        "8025/tcp": [{ HostIp: "0.0.0.0", HostPort: "18026" }],
        "465/tcp": [{ HostIp: "127.0.0.1", HostPort: "465" }],
      }),
    /loopback/u,
  );
  assert.throws(
    () =>
      resolvePublishedMailpitPorts({
        "8025/tcp": [{ HostIp: "127.0.0.1", HostPort: "18026" }],
        "465/tcp": [{ HostIp: "0.0.0.0", HostPort: "465" }],
      }),
    /loopback/u,
  );
});

test("running Mailpit supplies its verified TLS certificate across worktrees", () => {
  const source = readFileSync(new URL("./local-mailpit.mjs", import.meta.url), "utf8");
  assert.match(
    source,
    /if \(alreadyRunning\) \{\s+const containerId = mailpitContainerId\(handle\);\s+const \{ uiPort \} = readPublishedMailpitPorts\(handle, containerId\);\s+await waitForMailpit\(uiPort\);\s+const material = readContainerTlsMaterial\(handle, containerId\);/u,
  );
  assert.ok(source.includes("`${containerId}:/smtp-cert.pem`"));
  assert.ok(!source.includes("Mailpit TLS state is unavailable"));
});

test("local development defaults to Mailpit and ignores inherited SMTP providers", () => {
  assert.equal(resolveLocalEmailProvider({ SMTP_HOST: "smtp.example.test" }), "mailpit");
  assert.deepEqual(createLocalMailpitSmtpEnvironment("synthetic-ca"), {
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: "465",
    SMTP_SECURE: "true",
    SMTP_REQUIRE_TLS: "true",
    SMTP_TLS_CA: "synthetic-ca",
    SMTP_USER: "local-dev",
    SMTP_PASSWORD: "local-dev",
    AUTH_EMAIL_FROM: "no-reply@example.test",
    AUTH_EMAIL_FROM_NAME: "rhasia-scret-local",
  });
});

test("using an external SMTP provider requires an explicit local setting", () => {
  assert.equal(resolveLocalEmailProvider({ LOCAL_EMAIL_PROVIDER: " smtp " }), "smtp");
  assert.deepEqual(
    createConfiguredSmtpEnvironment({
      SMTP_HOST: "smtp.example.test",
      SMTP_PORT: "587",
      SMTP_USER: "synthetic-user",
      SMTP_PASSWORD: "synthetic-password",
      UNRELATED_SETTING: "not-forwarded",
    }),
    {
      SMTP_HOST: "smtp.example.test",
      SMTP_PORT: "587",
      SMTP_USER: "synthetic-user",
      SMTP_PASSWORD: "synthetic-password",
    },
  );
  assert.throws(
    () => resolveLocalEmailProvider({ LOCAL_EMAIL_PROVIDER: "unsupported" }),
    /must be either mailpit or smtp/u,
  );
});

test("invalid Mailpit UI ports fail before creating a Compose project", async () => {
  await assert.rejects(startLocalMailpit({ LOCAL_MAILPIT_UI_PORT: "0" }), /valid TCP port/u);
  await assert.rejects(startLocalMailpit({ LOCAL_MAILPIT_UI_PORT: "65536" }), /valid TCP port/u);
});

test("Mailpit lifecycle commands use the shared dev project and preserve the database volume", () => {
  const packageManifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const ignoreRules = readFileSync(new URL("../.gitignore", import.meta.url), "utf8");
  assert.equal(packageManifest.scripts["dev:mailpit"], "node tools/local-mailpit.mjs up");
  assert.ok(packageManifest.scripts["dev:down"].includes("confirm-database-operation.mjs"));
  assert.ok(packageManifest.scripts["dev:down"].includes("stop db mailpit"));
  assert.ok(!packageManifest.scripts["dev:down"].includes("down -v"));
  assert.ok(ignoreRules.split("\n").includes("/.local-mailpit/"));
});

test("the development Compose Mailpit service requires TLS and loopback-only access", () => {
  const compose = readFileSync(new URL("../docker-compose.dev.yml", import.meta.url), "utf8");
  assert.match(compose, /MP_SMTP_BIND_ADDR: 0\.0\.0\.0:465/u);
  assert.match(compose, /MP_SMTP_REQUIRE_TLS: "true"/u);
  assert.match(compose, /SMTP_TLS_CA: \$\{SMTP_TLS_CA:-\}/u);
  assert.match(compose, /127\.0\.0\.1:\$\{LOCAL_MAILPIT_UI_PORT:-8026\}:8025/u);
  assert.match(compose, /127\.0\.0\.1:465:465/u);
});
