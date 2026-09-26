import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  composeArguments,
  ensureLocalEnvironment,
  parseEnvFile,
  selfHostedUpComposeCommands,
  setEnvValue,
  validateSelfHostedEnvironment,
} from "./self-hosted.mjs";

test("parses simple and quoted dotenv values without exposing values in validation", () => {
  assert.deepEqual(parseEnvFile('AUTH_BACKEND=none\nWEB_ORIGIN="http://localhost:3000"\n# ignored\n'), {
    AUTH_BACKEND: "none",
    WEB_ORIGIN: "http://localhost:3000",
  });
});

test("validates the minimum local Compose contract", () => {
  const valid = {
    POSTGRES_PASSWORD: "local-database-password",
    PROXY_SECRET: "p".repeat(32),
    API_PROXY_SECRET: "p".repeat(32),
    CRON_SECRET: "c".repeat(32),
    AUTH_BACKEND: "none",
    WEB_ORIGIN: "http://localhost:3000",
    API_ORIGIN: "http://localhost:8787",
  };
  assert.deepEqual(validateSelfHostedEnvironment(valid), []);
  const unsupportedBackendErrors = validateSelfHostedEnvironment({ ...valid, AUTH_BACKEND: "oidc" });
  assert.ok(unsupportedBackendErrors.some((error) => error.includes("AUTH_BACKEND must be none or passwordless")));

  const errors = validateSelfHostedEnvironment({ ...valid, PROXY_SECRET: "replace-with-a-secret" });
  assert.ok(errors.some((error) => error.includes("PROXY_SECRET")));

  const mismatchErrors = validateSelfHostedEnvironment({ ...valid, API_PROXY_SECRET: "a".repeat(32) });
  assert.ok(mismatchErrors.some((error) => error.includes("must match")));
});

test("allows localhost HTTP while requiring HTTPS for non-local authentication", () => {
  const localErrors = validateSelfHostedEnvironment({
    POSTGRES_PASSWORD: "local-database-password",
    PROXY_SECRET: "p".repeat(32),
    API_PROXY_SECRET: "p".repeat(32),
    CRON_SECRET: "c".repeat(32),
    AUTH_BACKEND: "passwordless",
    WEB_ORIGIN: "http://localhost:3000",
    API_ORIGIN: "http://localhost:8787",
    AUTH_APP_ORIGIN: "http://localhost:3000",
  });
  assert.equal(localErrors.filter((error) => error.includes("HTTPS")).length, 0);

  const hostedErrors = validateSelfHostedEnvironment({
    POSTGRES_PASSWORD: "local-database-password",
    PROXY_SECRET: "p".repeat(32),
    API_PROXY_SECRET: "p".repeat(32),
    CRON_SECRET: "c".repeat(32),
    AUTH_BACKEND: "passwordless",
    WEB_ORIGIN: "http://vault.example.test",
    API_ORIGIN: "https://api.example.test",
    AUTH_APP_ORIGIN: "http://vault.example.test",
  });
  assert.ok(hostedErrors.some((error) => error.includes("WEB_ORIGIN") && error.includes("HTTPS")));
  assert.ok(hostedErrors.some((error) => error.includes("AUTH_APP_ORIGIN") && error.includes("HTTPS")));
});

test("rejects unsafe database passwords and malformed origins", () => {
  const errors = validateSelfHostedEnvironment({
    POSTGRES_PASSWORD: "contains@url-breaking-character",
    PROXY_SECRET: "p".repeat(32),
    API_PROXY_SECRET: "p".repeat(32),
    CRON_SECRET: "c".repeat(32),
    AUTH_BACKEND: "none",
    WEB_ORIGIN: "not-a-url",
    API_ORIGIN: "http://localhost:8787/path",
  });
  assert.ok(errors.some((error) => error.includes("URL-safe")));
  assert.ok(errors.some((error) => error.includes("WEB_ORIGIN")));
  assert.ok(errors.some((error) => error.includes("API_ORIGIN")));

  const nonLocalHttpErrors = validateSelfHostedEnvironment({
    POSTGRES_PASSWORD: "local-database-password",
    PROXY_SECRET: "p".repeat(32),
    API_PROXY_SECRET: "p".repeat(32),
    CRON_SECRET: "c".repeat(32),
    AUTH_BACKEND: "none",
    WEB_ORIGIN: "http://vault.example.test",
    API_ORIGIN: "http://api.example.test",
  });
  assert.ok(nonLocalHttpErrors.some((error) => error.includes("WEB_ORIGIN") && error.includes("HTTPS")));
  assert.ok(nonLocalHttpErrors.some((error) => error.includes("API_ORIGIN") && error.includes("HTTPS")));
});

test("repairs only example placeholders in an existing environment", () => {
  const root = mkdtempSync(join(tmpdir(), "rhasia-selfhosted-repair-"));
  try {
    const example = readFileSync(new URL("../.env.example", import.meta.url), "utf8");
    writeFileSync(join(root, ".env.example"), example);
    const source = example
      .replace("AUTH_BACKEND=passwordless", "AUTH_BACKEND=none")
      .replace(
        "POSTGRES_PASSWORD=replace-with-a-url-safe-database-password",
        "POSTGRES_PASSWORD=local-database-password",
      );
    writeFileSync(join(root, ".env"), source);

    const result = ensureLocalEnvironment({ root, commitSha: "test-sha" });
    assert.equal(result.created, false);
    assert.equal(result.updated, true);
    const values = parseEnvFile(readFileSync(result.envPath, "utf8"));
    assert.equal(validateSelfHostedEnvironment(values).length, 0);
    assert.equal(values.PROXY_SECRET, values.API_PROXY_SECRET);

    const second = ensureLocalEnvironment({ root, commitSha: "different-sha" });
    assert.equal(second.updated, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("preserves an example database password in an existing environment", () => {
  const root = mkdtempSync(join(tmpdir(), "rhasia-selfhosted-db-password-"));
  try {
    const example = readFileSync(new URL("../.env.example", import.meta.url), "utf8");
    writeFileSync(join(root, ".env.example"), example);
    writeFileSync(join(root, ".env"), example.replace("AUTH_BACKEND=passwordless", "AUTH_BACKEND=none"));

    const result = ensureLocalEnvironment({ root });
    const values = parseEnvFile(readFileSync(result.envPath, "utf8"));
    assert.match(values.POSTGRES_PASSWORD, /^replace-with-/u);
    assert.ok(validateSelfHostedEnvironment(values).some((error) => error.includes("database credential")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reuses a configured proxy secret when repairing its counterpart", () => {
  const root = mkdtempSync(join(tmpdir(), "rhasia-selfhosted-proxy-"));
  try {
    const example = readFileSync(new URL("../.env.example", import.meta.url), "utf8");
    writeFileSync(join(root, ".env.example"), example);
    const configured = example
      .replace("AUTH_BACKEND=passwordless", "AUTH_BACKEND=none")
      .replace(
        "PROXY_SECRET=replace-with-a-random-proxy-secret-at-least-32-characters",
        `PROXY_SECRET=${"p".repeat(32)}`,
      );
    writeFileSync(join(root, ".env"), configured);

    const result = ensureLocalEnvironment({ root });
    const values = parseEnvFile(readFileSync(result.envPath, "utf8"));
    assert.equal(values.PROXY_SECRET, "p".repeat(32));
    assert.equal(values.API_PROXY_SECRET, values.PROXY_SECRET);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("creates a local environment once and leaves it unchanged on rerun", () => {
  const root = mkdtempSync(join(tmpdir(), "rhasia-selfhosted-"));
  try {
    writeFileSync(join(root, ".env.example"), readFileSync(new URL("../.env.example", import.meta.url)));
    const first = ensureLocalEnvironment({ root, commitSha: "test-sha" });
    assert.equal(first.created, true);
    const firstSource = readFileSync(first.envPath, "utf8");
    const values = parseEnvFile(firstSource);
    assert.equal(values.AUTH_BACKEND, "none");
    assert.equal(values.COMMIT_SHA, "test-sha");
    assert.equal(validateSelfHostedEnvironment(values).length, 0);

    const second = ensureLocalEnvironment({ root, commitSha: "different-sha" });
    assert.equal(second.created, false);
    assert.equal(readFileSync(first.envPath, "utf8"), firstSource);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("replaces an existing dotenv key without touching comments", () => {
  const source = "# AUTH_BACKEND=comment\nAUTH_BACKEND=passwordless\n";
  assert.equal(setEnvValue(source, "AUTH_BACKEND", "none"), "# AUTH_BACKEND=comment\nAUTH_BACKEND=none\n");
});

test("builds a stable Compose project command", () => {
  assert.deepEqual(composeArguments("/repo", ["up", "-d"]), ["compose", "-f", "docker-compose.yml", "up", "-d"]);
});

test("builds images before starting without a second image pull", () => {
  assert.deepEqual(selfHostedUpComposeCommands(), {
    build: ["build"],
    start: ["up", "-d", "--wait", "--wait-timeout", "120", "--remove-orphans", "--no-build"],
  });
});
