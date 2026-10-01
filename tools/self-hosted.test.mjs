import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { request as httpRequest } from "node:http";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  composeArguments,
  cleanSelfHosted,
  confirmSelfHostedDatabaseCleanup,
  createSelfHostedCommandEnvironment,
  ensureLocalEnvironment,
  findExistingSelfHostedDatabaseVolumeWithoutEnvironment,
  parseEnvFile,
  SELF_HOSTED_PROJECT_NAME,
  selfHostedDatabaseAuthenticationCheckCommand,
  selfHostedUpComposeCommands,
  setEnvValue,
  validateSelfHostedEnvironment,
} from "./self-hosted.mjs";
import {
  chooseExistingEnvironment,
  confirmPublicFunnel,
  readConfiguredTailscaleMode,
  runSelfHostedInstall,
} from "./self-hosted-install.mjs";
import { applyTerminalTailscaleChoice, askLanguage, startConfigurationWizard } from "./self-hosted-configure.mjs";
import { WEB_FORBIDDEN_RUNTIME_ENVIRONMENT_KEYS } from "./verify-deployment-config.mjs";
import { parseCanonicalOrigin } from "./self-hosted-origin.mjs";
import { createServer } from "node:http";

test("self-hosted install runs configure, setup, and up in order with the interactive option", async () => {
  const calls = [];
  const exitCode = await runSelfHostedInstall({
    args: ["--interactive"],
    root: "/synthetic/repository",
    runStep: async (step, root) => {
      calls.push({ command: step.command, script: step.script, args: step.args, root });
      return 0;
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [
    {
      command: "pnpm selfhosted:configure",
      script: "tools/self-hosted-configure.mjs",
      args: ["--interactive"],
      root: "/synthetic/repository",
    },
    {
      command: "pnpm selfhosted:setup",
      script: "tools/self-hosted.mjs",
      args: ["setup"],
      root: "/synthetic/repository",
    },
    {
      command: "pnpm selfhosted:up",
      script: "tools/self-hosted.mjs",
      args: ["up"],
      root: "/synthetic/repository",
    },
  ]);
});

test("self-hosted install uses the terminal configuration wizard by default", async () => {
  let configureArguments;
  const exitCode = await runSelfHostedInstall({
    environmentExists: () => false,
    runStep: async (step) => {
      if (step.command === "pnpm selfhosted:configure") configureArguments = step.args;
      return 0;
    },
    readTailscaleMode: () => "none",
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(configureArguments, []);
});

test("self-hosted install asks before reusing an existing environment and skips configure when reused", async () => {
  const calls = [];
  let promptCount = 0;
  const exitCode = await runSelfHostedInstall({
    root: "/synthetic/repository",
    environmentExists: () => true,
    chooseEnvironment: async () => {
      promptCount += 1;
      return "reuse";
    },
    runStep: async (step) => {
      calls.push(step.command);
      return 0;
    },
    readTailscaleMode: () => "none",
  });

  assert.equal(exitCode, 0);
  assert.equal(promptCount, 1);
  assert.deepEqual(calls, ["pnpm selfhosted:setup", "pnpm selfhosted:up"]);
});

test("self-hosted install routes start-over through the backup-enabled configure mode", async () => {
  let configureArguments;
  const exitCode = await runSelfHostedInstall({
    root: "/synthetic/repository",
    environmentExists: () => true,
    chooseEnvironment: async () => "start-over",
    runStep: async (step) => {
      if (step.command === "pnpm selfhosted:configure") configureArguments = step.args;
      return 0;
    },
    readTailscaleMode: () => "none",
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(configureArguments, ["--replace-existing"]);
});

test("existing-environment prompt defaults to reuse and rejects non-interactive use", async () => {
  assert.equal(await chooseExistingEnvironment({ ask: async () => "" }), "reuse");
  assert.equal(await chooseExistingEnvironment({ ask: async () => "2" }), "start-over");
  await assert.rejects(
    chooseExistingEnvironment({ input: { isTTY: false }, output: { isTTY: false, write() {} } }),
    /interactive choice/u,
  );
});

test("self-hosted install stops at the first failed step and preserves its exit code", async () => {
  const calls = [];
  const exitCode = await runSelfHostedInstall({
    root: "/synthetic/repository",
    runStep: async (step) => {
      calls.push(step.command);
      return step.command === "pnpm selfhosted:setup" ? 19 : 0;
    },
  });

  assert.equal(exitCode, 19);
  assert.deepEqual(calls, ["pnpm selfhosted:configure", "pnpm selfhosted:setup"]);
});

test("self-hosted install rejects unsupported arguments before running a step", async () => {
  let stepsStarted = 0;
  const exitCode = await runSelfHostedInstall({
    args: ["--unknown"],
    runStep: async () => {
      stepsStarted += 1;
      return 0;
    },
  });

  assert.equal(exitCode, 2);
  assert.equal(stepsStarted, 0);
});

test("Web Docker build includes the self-hosted wizard modules needed to type-check its browser test", () => {
  const dockerfile = readFileSync(fileURLToPath(new URL("../apps/web/Dockerfile", import.meta.url)), "utf8");
  const buildStageStart = dockerfile.indexOf("FROM dependencies AS build");
  const runtimeStageStart = dockerfile.indexOf("\nFROM alpine:", buildStageStart);
  const buildStage = dockerfile.slice(buildStageStart, runtimeStageStart);
  const runtimeStage = dockerfile.slice(runtimeStageStart);
  const copyLine = buildStage.split(/\r?\n/u).find((line) => /^COPY tools\//u.test(line));
  const modules = [
    "self-hosted-configure.mjs",
    "self-hosted-configure.d.mts",
    "self-hosted.mjs",
    "self-hosted-origin.mjs",
    "self-hosted-configure-page.mjs",
  ];

  assert.ok(copyLine, "The Web image build stage should copy the wizard test's root module dependencies.");
  for (const module of modules) {
    assert.ok(existsSync(new URL(`./${module}`, import.meta.url)), `${module} should exist in the repository.`);
    assert.ok(copyLine.includes(`tools/${module}`), `${module} should be present in the build-stage COPY.`);
  }
  assert.doesNotMatch(runtimeStage, /COPY --from=build[^\n]*\/workspace\/tools/u);
});

test("self-hosted install enables selected Serve after application startup", async () => {
  const calls = [];
  const exitCode = await runSelfHostedInstall({
    root: "/synthetic/repository",
    runStep: async (step) => {
      calls.push(step);
      return 0;
    },
    readTailscaleMode: () => "serve",
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(
    calls.map(({ command }) => command),
    ["pnpm selfhosted:configure", "pnpm selfhosted:setup", "pnpm selfhosted:up", "pnpm selfhosted:tailscale serve"],
  );
  assert.deepEqual(calls[3].args, ["serve"]);
});

test("self-hosted install requires PUBLIC confirmation before enabling Funnel", async () => {
  const events = [];
  const exitCode = await runSelfHostedInstall({
    root: "/synthetic/repository",
    runStep: async (step) => {
      events.push(step.command);
      return 0;
    },
    readTailscaleMode: () => "funnel",
    confirmFunnel: async () => {
      events.push("confirm-public");
      return true;
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(events, [
    "pnpm selfhosted:configure",
    "pnpm selfhosted:setup",
    "pnpm selfhosted:up",
    "confirm-public",
    "pnpm selfhosted:tailscale funnel --confirm-public",
  ]);
});

test("declining Funnel confirmation leaves completed self-hosted services running", async () => {
  const commands = [];
  const exitCode = await runSelfHostedInstall({
    root: "/synthetic/repository",
    runStep: async (step) => {
      commands.push(step.command);
      return 0;
    },
    readTailscaleMode: () => "funnel",
    confirmFunnel: async () => false,
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(commands, ["pnpm selfhosted:configure", "pnpm selfhosted:setup", "pnpm selfhosted:up"]);
});

test("Funnel confirmation requires the exact PUBLIC token and an interactive terminal", async () => {
  assert.equal(await confirmPublicFunnel({ ask: async () => "PUBLIC" }), true);
  assert.equal(await confirmPublicFunnel({ ask: async () => "public" }), false);
  await assert.rejects(
    confirmPublicFunnel({ input: { isTTY: false }, output: { isTTY: false } }),
    /interactive terminal/u,
  );
});

test("self-hosted install reads the route choice from .env and defaults older configurations to none", () => {
  const root = mkdtempSync(join(tmpdir(), "rhasia-selfhosted-install-mode-"));
  try {
    assert.equal(readConfiguredTailscaleMode(root), "none");
    writeFileSync(join(root, ".env"), "SELF_HOSTED_TAILSCALE_MODE=funnel\n");
    assert.equal(readConfiguredTailscaleMode(root), "funnel");
    writeFileSync(join(root, ".env"), "SELF_HOSTED_TAILSCALE_MODE=unexpected\n");
    assert.throws(() => readConfiguredTailscaleMode(root), /must be none, serve, or funnel/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("root deployment configuration verification keeps API-only values out of the web check", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const env = {
    ...process.env,
    AUTH_BACKEND: "none",
    WEB_ORIGIN: "http://localhost:3000",
    API_ORIGIN: "http://localhost:8787",
    API_PROXY_SECRET: "a".repeat(32),
    DATABASE_URL: "postgresql://synthetic:synthetic@127.0.0.1:5432/synthetic",
    DIRECT_URL: "postgresql://synthetic:synthetic@127.0.0.1:5433/synthetic",
    POSTGRES_DB: "synthetic",
    POSTGRES_USER: "synthetic",
    POSTGRES_PASSWORD: "synthetic-password",
    PROXY_SECRET: "p".repeat(32),
    AUTH_MAGIC_LINK_SECRET: "m".repeat(32),
    AUTH_MAGIC_LINK_TTL_SECONDS: "600",
    AUTH_ACCESS_TOKEN_TTL_SECONDS: "600",
    AUTH_REFRESH_TOKEN_TTL_SECONDS: "600",
    TURNSTILE_SECRET_KEY: "t".repeat(32),
    SMTP_HOST: "smtp.example.test",
    SMTP_PORT: "587",
    SMTP_SECURE: "false",
    SMTP_REQUIRE_TLS: "true",
    SMTP_USER: "synthetic-user",
    SMTP_PASSWORD: "synthetic-password",
    AUTH_EMAIL_FROM: "robot@example.test",
    AUTH_EMAIL_FROM_NAME: "Rhasia Example",
    CRON_SECRET: "c".repeat(32),
    NODE_ENV: "development",
    VERIFY_DEPLOYMENT_PRODUCTION: "",
    DEPLOYMENT_TARGET: "bun",
  };
  const packageManager = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const result = spawnSync(packageManager, ["run", "verify:deployment-config"], {
    cwd: root,
    env,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;

  assert.equal(
    result.status,
    0,
    `Deployment configuration checks should pass with their respective runtime environments.\n${output}`,
  );
  assert.equal(
    (output.match(/\{"valid":true/gu) ?? []).length,
    2,
    "Both runtime checks should report valid configuration.",
  );
});

test("root deployment verification excludes every API-only key rejected by Web", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const webVerifier = readFileSync(join(root, "apps/web/scripts/verify-deployment-config.ts"), "utf8");
  const apiOnlyKeysMatch = webVerifier.match(/const API_ONLY_ENVIRONMENT_KEYS = \[([\s\S]*?)\] as const;/u);

  assert.ok(apiOnlyKeysMatch, "The Web verifier should declare its API-only environment keys.");
  const webVerifierKeys = [...apiOnlyKeysMatch[1].matchAll(/"([^"]+)"/gu)].map(([, key]) => key);

  assert.deepEqual([...WEB_FORBIDDEN_RUNTIME_ENVIRONMENT_KEYS].sort(), webVerifierKeys.sort());
});

test("terminal language selection does not print a duplicate wizard brand", async () => {
  const output = [];
  const originalLog = console.log;
  console.log = (...values) => output.push(values.map(String).join(" "));

  try {
    assert.equal(await askLanguage({ ask: async () => "en" }), "en");
  } finally {
    console.log = originalLog;
  }

  assert.equal(
    output.some((line) => line.includes("rhasia-scret")),
    false,
  );
});

test("parses simple and quoted dotenv values without exposing values in validation", () => {
  assert.deepEqual(parseEnvFile('AUTH_BACKEND=none\nWEB_ORIGIN="http://localhost:3000"\n# ignored\n'), {
    AUTH_BACKEND: "none",
    WEB_ORIGIN: "http://localhost:3000",
  });
});

test("parses canonical origins without credentials, paths, queries, or fragments", () => {
  assert.equal(parseCanonicalOrigin("https://vault.example.test")?.origin, "https://vault.example.test");
  for (const value of [
    "https://operator@vault.example.test",
    "https://vault.example.test/path",
    "https://vault.example.test?query=value",
    "https://vault.example.test#fragment",
    "not a URL",
  ]) {
    assert.equal(parseCanonicalOrigin(value), undefined);
  }
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
  assert.ok(
    validateSelfHostedEnvironment({ ...valid, SELF_HOSTED_TAILSCALE_MODE: "public" }).some((error) =>
      error.includes("SELF_HOSTED_TAILSCALE_MODE must be none, serve, or funnel"),
    ),
  );
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

test("detects an existing self-hosted database volume before creating a missing .env", () => {
  const root = mkdtempSync(join(tmpdir(), "rhasia-selfhosted-existing-volume-"));
  const volumeName = `${SELF_HOSTED_PROJECT_NAME}_postgres-data`;
  let inspected = false;
  try {
    const result = findExistingSelfHostedDatabaseVolumeWithoutEnvironment({
      root,
      run: (command, arguments_, options) => {
        inspected = true;
        assert.equal(command, "docker");
        assert.deepEqual(arguments_.slice(0, 2), ["volume", "ls"]);
        assert.equal(options.encoding, "utf8");
        return { status: 0, stdout: `${volumeName}\n` };
      },
    });

    assert.equal(result, volumeName);
    assert.equal(inspected, true);
    assert.equal(existsSync(join(root, ".env")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("skips the fresh-environment volume check when .env already exists", () => {
  const root = mkdtempSync(join(tmpdir(), "rhasia-selfhosted-configured-volume-"));
  try {
    writeFileSync(join(root, ".env"), "POSTGRES_PASSWORD=synthetic-database-password\n", { mode: 0o600 });
    const result = findExistingSelfHostedDatabaseVolumeWithoutEnvironment({
      root,
      run: () => {
        throw new Error("The volume command must not run for an existing .env.");
      },
    });
    assert.equal(result, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("validates explicit Docker bind addresses and published ports", () => {
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
  assert.deepEqual(validateSelfHostedEnvironment({ ...valid, APP_BIND_ADDRESS: "192.0.2.10", APP_PORT: "3400" }), []);
  assert.ok(
    validateSelfHostedEnvironment({ ...valid, APP_BIND_ADDRESS: "0.0.0.0;echo unsafe" }).some((error) =>
      error.includes("APP_BIND_ADDRESS"),
    ),
  );
  assert.ok(validateSelfHostedEnvironment({ ...valid, APP_PORT: "65536" }).some((error) => error.includes("APP_PORT")));
  assert.ok(validateSelfHostedEnvironment({ ...valid, APP_PORT: "0" }).some((error) => error.includes("APP_PORT")));
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
  assert.equal(
    setEnvValue("SMTP_PASSWORD=old\n", "SMTP_PASSWORD", "literal-$&-value"),
    "SMTP_PASSWORD=literal-$&-value\n",
  );
});

test("builds a stable Compose project command", () => {
  assert.deepEqual(composeArguments("/repo", ["up", "-d"]), ["compose", "-f", "docker-compose.yml", "up", "-d"]);
});

test("self-hosted cleanup requires typing the exact PostgreSQL volume name", async () => {
  const volumeName = `${SELF_HOSTED_PROJECT_NAME}_postgres-data`;
  let prompt;

  assert.equal(
    await confirmSelfHostedDatabaseCleanup(volumeName, {
      ask: async (value) => {
        prompt = value;
        return ` ${volumeName} `;
      },
    }),
    true,
  );
  assert.match(prompt, /permanently deletes all PostgreSQL data/u);
  assert.match(prompt, new RegExp(volumeName, "u"));

  assert.equal(
    await confirmSelfHostedDatabaseCleanup(volumeName, {
      ask: async () => "yes",
    }),
    false,
  );
});

test("self-hosted cleanup fails closed without an interactive terminal", async () => {
  await assert.rejects(
    confirmSelfHostedDatabaseCleanup(`${SELF_HOSTED_PROJECT_NAME}_postgres-data`, {
      input: { isTTY: false },
      output: { isTTY: false },
    }),
    /interactive terminal/u,
  );
});

test("self-hosted cleanup stops only its Compose project before removing its exact database volume", async () => {
  const root = mkdtempSync(join(tmpdir(), "rhasia-selfhosted-clean-"));
  const volumeName = `${SELF_HOSTED_PROJECT_NAME}_postgres-data`;
  const events = [];
  const commands = [];
  writeFileSync(join(root, "docker-compose.yml"), readFileSync(new URL("../docker-compose.yml", import.meta.url)));

  try {
    const cleaned = await cleanSelfHosted({
      root,
      confirm: async (name) => {
        events.push(["confirm", name]);
        return true;
      },
      inspectVolume: () => volumeName,
      run: (command, arguments_) => {
        commands.push([command, arguments_]);
        events.push(["command", command, arguments_]);
      },
      commitSha: "synthetic-test-sha",
      log: () => {},
    });

    assert.equal(cleaned, true);
    assert.deepEqual(events[2], ["confirm", volumeName]);
    assert.deepEqual(commands.slice(-2), [
      ["docker", ["compose", "-f", "docker-compose.yml", "down", "--remove-orphans"]],
      ["docker", ["volume", "rm", volumeName]],
    ]);
    assert.equal(commands.at(-2)[1].includes("-v"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("self-hosted cleanup performs no changes when no database volume exists", async () => {
  const root = mkdtempSync(join(tmpdir(), "rhasia-selfhosted-clean-empty-"));
  const commands = [];
  let confirmations = 0;
  writeFileSync(join(root, "docker-compose.yml"), readFileSync(new URL("../docker-compose.yml", import.meta.url)));

  try {
    const cleaned = await cleanSelfHosted({
      root,
      confirm: async () => {
        confirmations += 1;
        return true;
      },
      inspectVolume: () => null,
      run: (command, arguments_) => commands.push([command, arguments_]),
      log: () => {},
    });

    assert.equal(cleaned, false);
    assert.equal(confirmations, 0);
    assert.deepEqual(commands, [
      ["docker", ["compose", "version"]],
      ["docker", ["info", "--format", "{{.ServerVersion}}"]],
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("self-hosted cleanup performs no changes when the exact volume confirmation is declined", async () => {
  const root = mkdtempSync(join(tmpdir(), "rhasia-selfhosted-clean-declined-"));
  const commands = [];
  writeFileSync(join(root, "docker-compose.yml"), readFileSync(new URL("../docker-compose.yml", import.meta.url)));

  try {
    await assert.rejects(
      cleanSelfHosted({
        root,
        confirm: async () => false,
        inspectVolume: () => `${SELF_HOSTED_PROJECT_NAME}_postgres-data`,
        run: (command, arguments_) => commands.push([command, arguments_]),
        commitSha: "synthetic-test-sha",
        log: () => {},
      }),
      /was not confirmed/u,
    );

    assert.deepEqual(commands, [
      ["docker", ["compose", "version"]],
      ["docker", ["info", "--format", "{{.ServerVersion}}"]],
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("self-hosted cleanup rejects any Docker volume other than the fixed Compose database volume", async () => {
  const root = mkdtempSync(join(tmpdir(), "rhasia-selfhosted-clean-unexpected-"));
  const commands = [];
  let confirmations = 0;
  writeFileSync(join(root, "docker-compose.yml"), readFileSync(new URL("../docker-compose.yml", import.meta.url)));

  try {
    await assert.rejects(
      cleanSelfHosted({
        root,
        confirm: async () => {
          confirmations += 1;
          return true;
        },
        inspectVolume: () => "other-project_postgres-data",
        run: (command, arguments_) => commands.push([command, arguments_]),
        log: () => {},
      }),
      /unexpected PostgreSQL volume name/u,
    );
    assert.equal(confirmations, 0);
    assert.deepEqual(commands, [
      ["docker", ["compose", "version"]],
      ["docker", ["info", "--format", "{{.ServerVersion}}"]],
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("self-hosted commands use .env values instead of shell overrides for Compose settings", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const variableNames = ["AUTH_BACKEND", "AUTH_TRUST_PROXY_HEADERS", "APP_PORT", "SMTP_PASSWORD", "COMPOSE_PROFILES"];
  const previousValues = new Map(variableNames.map((name) => [name, process.env[name]]));
  Object.assign(process.env, {
    AUTH_BACKEND: "none",
    AUTH_TRUST_PROXY_HEADERS: "true",
    APP_PORT: "9999",
    SMTP_PASSWORD: "unexpected-shell-value",
    COMPOSE_PROFILES: "migration",
  });

  try {
    const environment = createSelfHostedCommandEnvironment(
      {
        root,
        values: {
          AUTH_BACKEND: "passwordless",
          AUTH_TRUST_PROXY_HEADERS: "false",
          APP_PORT: "3400",
          SMTP_PASSWORD: "synthetic-provider-password",
          COMPOSE_PROFILES: "migration",
        },
      },
      { COMPOSE_PROJECT_NAME: "rhasia-scret-selfhosted" },
    );
    assert.ok(environment.AUTH_BACKEND === "passwordless", "The .env authentication mode should take precedence.");
    assert.ok(environment.AUTH_TRUST_PROXY_HEADERS === "false", "The .env proxy setting should take precedence.");
    assert.equal(environment.APP_PORT, "3400");
    assert.ok(environment.SMTP_PASSWORD === "synthetic-provider-password", "The fixture secret should be preserved.");
    assert.equal(environment.COMPOSE_PROFILES, "");
  } finally {
    for (const [name, value] of previousValues) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("builds images before starting without a second image pull", () => {
  assert.deepEqual(selfHostedUpComposeCommands(), {
    build: ["build"],
    start: ["up", "-d", "--wait", "--wait-timeout", "120", "--remove-orphans", "--no-build"],
  });
});

test("database credential preflight uses the running container environment for a read-only query", () => {
  const command = selfHostedDatabaseAuthenticationCheckCommand();

  assert.deepEqual(command.slice(0, 5), ["exec", "-T", "db", "sh", "-c"]);
  assert.match(command[5], /PGPASSWORD="\$POSTGRES_PASSWORD"/u);
  assert.match(command[5], /--host=db/u);
  assert.doesNotMatch(command[5], /--host=127\.0\.0\.1/u);
  assert.match(command[5], /--username="\$POSTGRES_USER"/u);
  assert.match(command[5], /--dbname="\$POSTGRES_DB"/u);
  assert.match(command[5], /--command="SELECT 1"/u);
  assert.doesNotMatch(command.join(" "), /synthetic-database-password/iu);
});

test("publishes the self-hosted web port on loopback by default and honors a bind address override", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const tempRoot = mkdtempSync(join(tmpdir(), "rhasia-selfhosted-compose-"));
  const envPath = join(tempRoot, ".env");
  const baseValues = [
    "COMMIT_SHA=test-sha",
    "POSTGRES_PASSWORD=synthetic-db-password",
    `PROXY_SECRET=${"p".repeat(32)}`,
    `API_PROXY_SECRET=${"p".repeat(32)}`,
    `CRON_SECRET=${"c".repeat(32)}`,
  ].join("\n");

  try {
    const resolveWebBinding = (extraValues = "") => {
      writeFileSync(envPath, `${baseValues}\n${extraValues}\n`);
      const result = spawnSync(
        "docker",
        ["compose", "--env-file", envPath, "-f", "docker-compose.yml", "config", "--format", "json"],
        {
          cwd: root,
          env: createSelfHostedCommandEnvironment({ root, values: parseEnvFile(readFileSync(envPath, "utf8")) }),
          encoding: "utf8",
        },
      );
      assert.ok(result.status === 0, "Docker Compose should resolve the synthetic fixture configuration.");
      const config = JSON.parse(result.stdout);
      return config.services.web.ports[0];
    };

    assert.deepEqual(resolveWebBinding(), {
      mode: "ingress",
      protocol: "tcp",
      published: "3000",
      target: 3000,
      host_ip: "127.0.0.1",
    });
    assert.deepEqual(resolveWebBinding("APP_BIND_ADDRESS=192.0.2.10\nAPP_PORT=3400"), {
      mode: "ingress",
      protocol: "tcp",
      published: "3400",
      target: 3000,
      host_ip: "192.0.2.10",
    });
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("configuration wizard writes a protected .env through its loopback HTTP form without echoing values", async () => {
  const root = mkdtempSync(join(tmpdir(), "rhasia-selfhosted-wizard-"));
  writeFileSync(join(root, ".env.example"), readFileSync(new URL("../.env.example", import.meta.url)));
  writeFileSync(join(root, "docker-compose.yml"), readFileSync(new URL("../docker-compose.yml", import.meta.url)));
  const wizard = await startConfigurationWizard({
    root,
    commitSha: "test-sha",
    tailscaleOrigin: "https://node.example.test",
  });

  try {
    const page = await requestWizard(wizard.url);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("cache-control"), /no-store/u);
    assert.match(page.headers.get("content-security-policy"), /frame-ancestors 'none'/u);
    assert.match(page.headers.get("set-cookie"), /HttpOnly; SameSite=Strict/u);
    assert.equal(page.body.includes("rhasia_setup_session"), false);
    assert.match(page.body, /Kembali ke terminal untuk melihat langkah berikutnya/u);
    assert.match(page.body, /Return to the terminal for the next step/u);
    assert.match(page.body, /https:\/\/node\.example\.test/u);
    assert.match(page.body, /src="\/wizard\.js"/u);
    const setupCookie = page.headers.get("set-cookie").split(";", 1)[0];
    const unauthorizedClient = await requestWizard(`${wizard.url}wizard.js`);
    assert.equal(unauthorizedClient.status, 403);
    const wizardClient = await requestWizard(`${wizard.url}wizard.js`, { headers: { cookie: setupCookie } });
    assert.equal(wizardClient.status, 200);
    assert.match(wizardClient.headers.get("content-type"), /javascript/u);
    assert.ok(wizardClient.body.length > 1_000, "The authenticated wizard should receive its form client.");
    assert.match(wizardClient.body, /setup-success-dialog/u);
    assert.match(wizardClient.body, /showModal\(\)/u);
    assert.match(wizardClient.body, /tailscaleMode/u);
    const submission = {
      authBackend: "passwordless",
      tailscaleMode: "none",
      webOrigin: "https://vault.example.test",
      turnstileSiteKey: "",
      turnstileSecretKey: "",
      smtpHost: "smtp.example.test",
      smtpPort: "587",
      smtpUser: "operator@example.test",
      smtpPassword: "synthetic-smtp-password-$-value",
      authEmailFrom: "no-reply@example.test",
      authEmailFromName: "rhasia-scret",
      passkeyEnabled: false,
      passkeyRpId: "",
      passkeyOrigin: "",
      appBindAddress: "127.0.0.1",
      appPort: "3000",
    };
    const hostileOrigin = await requestWizard(`${wizard.url}configure`, {
      method: "POST",
      headers: {
        cookie: setupCookie,
        origin: "https://attacker.example.test",
        "content-type": "application/json",
      },
      body: JSON.stringify(submission),
    });
    assert.equal(hostileOrigin.status, 403);
    assert.equal(existsSync(join(root, ".env")), false);

    const unsupportedField = await requestWizard(`${wizard.url}configure`, {
      method: "POST",
      headers: {
        cookie: setupCookie,
        origin: new URL(wizard.url).origin,
        "content-type": "application/json",
      },
      body: JSON.stringify({ ...submission, unexpected: "synthetic" }),
    });
    assert.equal(unsupportedField.status, 400);
    assert.match(unsupportedField.body, /invalid_request/u);
    assert.equal(existsSync(join(root, ".env")), false);

    const unsupportedSmtpPort = await requestWizard(`${wizard.url}configure`, {
      method: "POST",
      headers: {
        cookie: setupCookie,
        origin: new URL(wizard.url).origin,
        "content-type": "application/json",
      },
      body: JSON.stringify({ ...submission, smtpPort: "2525" }),
    });
    assert.equal(unsupportedSmtpPort.status, 400);
    assert.match(unsupportedSmtpPort.body, /smtpPort:invalid/u);
    assert.equal(existsSync(join(root, ".env")), false);

    const hostileHost = await requestWizard(wizard.url, { headers: { host: "attacker.example.test" } });
    assert.equal(hostileHost.status, 403);

    const response = await requestWizard(`${wizard.url}configure`, {
      method: "POST",
      headers: {
        cookie: setupCookie,
        origin: new URL(wizard.url).origin,
        "content-type": "application/json",
      },
      body: JSON.stringify(submission),
    });

    assert.equal(response.status, 201, response.body);
    assert.equal(response.body.includes(submission.smtpPassword), false);
    await wizard.closed;

    const envSource = readFileSync(join(root, ".env"), "utf8");
    const values = parseEnvFile(envSource);
    assert.equal(values.AUTH_BACKEND, "passwordless");
    assert.equal(values.WEB_ORIGIN, "https://vault.example.test");
    assert.equal(values.AUTH_APP_ORIGIN, values.WEB_ORIGIN);
    assert.equal(values.NEXT_PUBLIC_TURNSTILE_SITE_KEY, "");
    assert.equal(values.TURNSTILE_SECRET_KEY, "");
    assert.ok(values.SMTP_PASSWORD === submission.smtpPassword, "The wizard should preserve the submitted SMTP value.");
    assert.equal(values.AUTH_TRUST_PROXY_HEADERS, "false");
    assert.equal(values.PROXY_SECRET, values.API_PROXY_SECRET);
    assert.notEqual(values.AUTH_MAGIC_LINK_SECRET, values.AUTH_SESSION_SECRET);
    assert.equal(values.PASSKEY_RP_ID, "");
    assert.deepEqual(validateSelfHostedEnvironment(values), []);
    assert.equal(readFileSync(join(root, ".env"), "utf8").includes("replace-with-"), false);
    assert.equal((await import("node:fs")).statSync(join(root, ".env")).mode & 0o777, 0o600);

    const compose = spawnSync("docker", ["compose", "-f", "docker-compose.yml", "config", "--format", "json"], {
      cwd: root,
      env: { ...createSelfHostedCommandEnvironment({ root, values: {} }), COMPOSE_PROFILES: "" },
      encoding: "utf8",
    });
    assert.ok(compose.status === 0, "Docker Compose should resolve the synthetic wizard configuration.");
    const composeConfig = JSON.parse(compose.stdout);
    assert.equal(composeConfig.services.web.ports[0].host_ip, "127.0.0.1");
    assert.ok(composeConfig.services.web.healthcheck.test.some((command) => command.includes("/healthz")));
    assert.ok(
      composeConfig.services.api.environment.SMTP_PASSWORD === submission.smtpPassword.split("$").join("$$"),
      "Docker Compose should preserve the synthetic SMTP fixture value.",
    );
  } finally {
    await wizard.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("configuration wizard refuses to overwrite an existing .env", async () => {
  const root = mkdtempSync(join(tmpdir(), "rhasia-selfhosted-wizard-existing-"));
  try {
    const existing = "KEEP_EXISTING_CONFIGURATION=true\n";
    writeFileSync(join(root, ".env"), existing, { mode: 0o600 });
    await assert.rejects(startConfigurationWizard({ root }), /reuse it or rerun setup/u);
    assert.equal(readFileSync(join(root, ".env"), "utf8"), existing);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("start-over backs up .env with restrictive permissions and preserves database settings", async () => {
  const root = mkdtempSync(join(tmpdir(), "rhasia-selfhosted-wizard-replace-"));
  writeFileSync(join(root, ".env.example"), readFileSync(new URL("../.env.example", import.meta.url)));
  const existing = [
    "DATABASE_URL=postgresql://legacy_user:synthetic-database-password@127.0.0.1:55432/legacy_database?schema=public",
    "DIRECT_URL=postgresql://legacy_user:synthetic-database-password@127.0.0.1:55432/legacy_database?schema=public",
    "POSTGRES_DB=legacy_database",
    "POSTGRES_USER=legacy_user",
    "POSTGRES_PASSWORD=synthetic-database-password",
    "POSTGRES_HOST_PORT=55433",
    "KEEP_ME_ONLY_IN_BACKUP=synthetic-old-value",
    "",
  ].join("\n");
  writeFileSync(join(root, ".env"), existing, { mode: 0o600 });
  const wizard = await startConfigurationWizard({
    root,
    commitSha: "test-sha",
    tailscaleOrigin: null,
    replaceExisting: true,
  });

  try {
    const page = await requestWizard(wizard.url);
    const setupCookie = page.headers.get("set-cookie").split(";", 1)[0];
    const submission = {
      authBackend: "none",
      tailscaleMode: "none",
      webOrigin: "http://localhost:3000",
      turnstileSiteKey: "",
      turnstileSecretKey: "",
      smtpHost: "",
      smtpPort: "587",
      smtpUser: "",
      smtpPassword: "",
      authEmailFrom: "",
      authEmailFromName: "rhasia-scret",
      passkeyEnabled: false,
      passkeyRpId: "",
      passkeyOrigin: "",
      appBindAddress: "127.0.0.1",
      appPort: "3000",
    };
    const response = await requestWizard(`${wizard.url}configure`, {
      method: "POST",
      headers: {
        cookie: setupCookie,
        origin: new URL(wizard.url).origin,
        "content-type": "application/json",
      },
      body: JSON.stringify(submission),
    });

    assert.equal(response.status, 201, response.body);
    await wizard.closed;

    assert.match(wizard.backupPath, /\.env\.backup-\d{8}T\d{9}Z(?:-\d+)?$/u);
    assert.equal(readFileSync(wizard.backupPath, "utf8"), existing);
    assert.equal(statSync(wizard.backupPath).mode & 0o777, 0o600);
    assert.equal(statSync(join(root, ".env")).mode & 0o777, 0o600);

    const values = parseEnvFile(readFileSync(join(root, ".env"), "utf8"));
    assert.equal(
      values.DATABASE_URL,
      "postgresql://legacy_user:synthetic-database-password@127.0.0.1:55432/legacy_database?schema=public",
    );
    assert.equal(values.DIRECT_URL, values.DATABASE_URL);
    assert.equal(values.POSTGRES_DB, "legacy_database");
    assert.equal(values.POSTGRES_USER, "legacy_user");
    assert.equal(values.POSTGRES_PASSWORD, "synthetic-database-password");
    assert.equal(values.POSTGRES_HOST_PORT, "55433");
    assert.equal(values.KEEP_ME_ONLY_IN_BACKUP, undefined);
    assert.equal(values.AUTH_BACKEND, "none");
    assert.notEqual(values.PROXY_SECRET, "replace-with-a-random-proxy-secret-at-least-32-characters");
  } finally {
    await wizard.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("start-over refuses to replace an environment without a database password to preserve", async () => {
  const root = mkdtempSync(join(tmpdir(), "rhasia-selfhosted-wizard-no-db-password-"));
  try {
    writeFileSync(join(root, ".env"), "AUTH_BACKEND=none\n", { mode: 0o600 });
    await assert.rejects(
      startConfigurationWizard({ root, replaceExisting: true }),
      /no POSTGRES_PASSWORD to preserve/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("start-over refuses a symlinked .env without changing its target", async () => {
  const root = mkdtempSync(join(tmpdir(), "rhasia-selfhosted-wizard-symlink-"));
  const target = join(root, "external-env");
  const envPath = join(root, ".env");
  writeFileSync(target, "POSTGRES_PASSWORD=synthetic-database-password\n", { mode: 0o600 });
  symlinkSync(target, envPath);

  try {
    await assert.rejects(startConfigurationWizard({ root, replaceExisting: true }), { code: "ELOOP" });
    assert.equal(readFileSync(target, "utf8"), "POSTGRES_PASSWORD=synthetic-database-password\n");
    assert.equal(readlinkSync(envPath), target);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("timestamped .env backups are ignored by Git", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const result = spawnSync("git", ["check-ignore", "--no-index", ".env.backup-20261001T000000000Z"], {
    cwd: root,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, "Credential-bearing .env backups must never be staged accidentally.");
});

test("wizard accepts a Tailscale HTTPS origin with no auth and omits unused provider fields", async () => {
  const root = mkdtempSync(join(tmpdir(), "rhasia-selfhosted-wizard-local-"));
  writeFileSync(join(root, ".env.example"), readFileSync(new URL("../.env.example", import.meta.url)));
  const wizard = await startConfigurationWizard({ root, commitSha: "test-sha", tailscaleOrigin: null });
  try {
    const page = await requestWizard(wizard.url);
    const setupCookie = page.headers.get("set-cookie").split(";", 1)[0];
    const submission = {
      authBackend: "none",
      tailscaleMode: "none",
      webOrigin: "https://node.example.test",
      turnstileSiteKey: "synthetic-turnstile-site-key",
      turnstileSecretKey: "synthetic-turnstile-secret-key",
      smtpHost: "smtp.example.test",
      smtpPort: "587",
      smtpUser: "operator@example.test",
      smtpPassword: "synthetic-smtp-password",
      authEmailFrom: "no-reply@example.test",
      authEmailFromName: "rhasia-scret",
      passkeyEnabled: false,
      passkeyRpId: "",
      passkeyOrigin: "",
      appBindAddress: "127.0.0.1",
      appPort: "3000",
    };
    const response = await requestWizard(`${wizard.url}configure`, {
      method: "POST",
      headers: {
        cookie: setupCookie,
        origin: new URL(wizard.url).origin,
        "content-type": "application/json",
      },
      body: JSON.stringify(submission),
    });
    assert.equal(response.status, 201, response.body);
    await wizard.closed;
    const values = parseEnvFile(readFileSync(join(root, ".env"), "utf8"));
    assert.equal(values.AUTH_BACKEND, "none");
    assert.equal(values.WEB_ORIGIN, "https://node.example.test");
    assert.equal(values.AUTH_APP_ORIGIN, "");
    assert.equal(values.SMTP_PASSWORD, "");
    assert.equal(values.TURNSTILE_SECRET_KEY, "");
  } finally {
    await wizard.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("wizard enables trusted proxy headers for passwordless on the detected Tailscale origin", async () => {
  const root = mkdtempSync(join(tmpdir(), "rhasia-selfhosted-wizard-tailscale-passwordless-"));
  writeFileSync(join(root, ".env.example"), readFileSync(new URL("../.env.example", import.meta.url)));
  const wizard = await startConfigurationWizard({
    root,
    commitSha: "test-sha",
    tailscaleOrigin: "https://node.example.test",
  });
  try {
    const page = await requestWizard(wizard.url);
    const setupCookie = page.headers.get("set-cookie").split(";", 1)[0];
    const submission = {
      authBackend: "passwordless",
      tailscaleMode: "serve",
      webOrigin: "https://node.example.test",
      turnstileSiteKey: "synthetic-turnstile-site-key",
      turnstileSecretKey: "synthetic-turnstile-secret-key",
      smtpHost: "smtp.example.test",
      smtpPort: "587",
      smtpUser: "operator@example.test",
      smtpPassword: "synthetic-smtp-password",
      authEmailFrom: "no-reply@example.test",
      authEmailFromName: "rhasia-scret",
      passkeyEnabled: false,
      passkeyRpId: "",
      passkeyOrigin: "",
      appBindAddress: "127.0.0.1",
      appPort: "3000",
    };
    const mismatchedTailscaleOrigin = await requestWizard(`${wizard.url}configure`, {
      method: "POST",
      headers: {
        cookie: setupCookie,
        origin: new URL(wizard.url).origin,
        "content-type": "application/json",
      },
      body: JSON.stringify({ ...submission, webOrigin: "https://vault.example.test" }),
    });
    assert.equal(mismatchedTailscaleOrigin.status, 400);
    assert.match(mismatchedTailscaleOrigin.body, /webOrigin:tailscale_origin/u);
    assert.equal(existsSync(join(root, ".env")), false);

    const response = await requestWizard(`${wizard.url}configure`, {
      method: "POST",
      headers: {
        cookie: setupCookie,
        origin: new URL(wizard.url).origin,
        "content-type": "application/json",
      },
      body: JSON.stringify(submission),
    });
    assert.equal(response.status, 201, response.body);
    await wizard.closed;

    const values = parseEnvFile(readFileSync(join(root, ".env"), "utf8"));
    assert.equal(values.AUTH_BACKEND, "passwordless");
    assert.equal(values.SELF_HOSTED_TAILSCALE_MODE, "serve");
    assert.equal(values.AUTH_TRUST_PROXY_HEADERS, "true");
    assert.equal(values.WEB_ORIGIN, "https://node.example.test");
    assert.equal(values.AUTH_APP_ORIGIN, "https://node.example.test");
    assert.equal(values.AUTH_TRUST_PROXY_HEADERS, "true");
    assert.equal(values.SMTP_PASSWORD, submission.smtpPassword);
  } finally {
    await wizard.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("terminal Tailscale choices preserve authentication and use the detected MagicDNS origin and loopback configuration", () => {
  for (const authBackend of ["none", "passwordless"]) {
    for (const [choice, expectedMode] of [
      ["2", "serve"],
      ["3", "funnel"],
    ]) {
      const submission = {
        authBackend,
        webOrigin: "http://localhost:3000",
        appBindAddress: "0.0.0.0",
        appPort: "3400",
      };

      assert.equal(applyTerminalTailscaleChoice(choice, "https://node.example.test", submission), expectedMode);
      assert.equal(submission.authBackend, authBackend);
      assert.equal(submission.webOrigin, "https://node.example.test");
      assert.equal(submission.appBindAddress, "127.0.0.1");
      assert.equal(submission.appPort, "3400");
    }
  }
});

test("terminal Tailscale skip leaves the selected setup unchanged", () => {
  const submission = {
    authBackend: "passwordless",
    webOrigin: "http://localhost:3000",
    appBindAddress: "0.0.0.0",
  };
  const original = { ...submission };

  assert.equal(applyTerminalTailscaleChoice("1", "https://node.example.test", submission), null);
  assert.deepEqual(submission, original);
});

test("Tailscale Serve and Funnel commands use loopback, require public confirmation, and remove only their recorded listener", async (context) => {
  if (process.platform === "win32") return context.skip("The fake Tailscale executable uses a Unix shebang.");

  for (const mode of ["serve", "funnel"]) {
    await context.test(`${mode} lifecycle`, async () => {
      const root = mkdtempSync(join(tmpdir(), `rhasia-selfhosted-${mode}-`));
      const bin = join(root, "bin");
      const fakeStatusPath = join(root, "tailscale-status.json");
      const fakeLogPath = join(root, "tailscale-commands.jsonl");
      mkdirSync(bin);

      let healthStatus = 200;
      let transientHealthStatuses = [];
      const healthServer = createServer((request, response) => {
        if (request.url !== "/healthz") {
          response.writeHead(404).end();
          return;
        }
        const responseStatus = transientHealthStatuses.shift() ?? healthStatus;
        response.writeHead(responseStatus, { "content-type": "application/json" }).end('{"status":"ok"}');
      });
      await new Promise((resolve) => healthServer.listen(0, "127.0.0.1", resolve));
      const healthPort = healthServer.address().port;
      writeTailscaleEnvironment(root, healthPort);
      const fakeDockerPath = join(bin, "docker");
      writeFileSync(fakeDockerPath, fakeDockerProgram, { mode: 0o700 });
      chmodSync(fakeDockerPath, 0o700);
      const fakeCliPath = join(bin, "tailscale");
      writeFileSync(fakeCliPath, fakeTailscaleProgram, { mode: 0o700 });
      chmodSync(fakeCliPath, 0o700);

      try {
        const runWithEnvironment = (extraEnvironment, ...arguments_) =>
          runProcess(
            process.execPath,
            [new URL("./self-hosted-tailscale.mjs", import.meta.url).pathname, ...arguments_],
            {
              cwd: root,
              env: {
                ...process.env,
                PATH: `${bin}:${process.env.PATH}`,
                FAKE_TAILSCALE_STATUS: fakeStatusPath,
                FAKE_TAILSCALE_LOG: fakeLogPath,
                FAKE_APP_PORT: String(healthPort),
                FAKE_DOCKER_HOST_PORT: String(healthPort),
                FAKE_DOCKER_WEB_BACKEND: "none",
                FAKE_DOCKER_API_BACKEND: "none",
                FAKE_DOCKER_PROXY_TRUST: "false",
                FAKE_DOCKER_WEB_ORIGIN: "https://node.example.test",
                FAKE_DOCKER_API_ORIGIN: "https://node.example.test",
                FAKE_DOCKER_WEB_AUTH_ORIGIN: "https://node.example.test",
                FAKE_DOCKER_API_AUTH_ORIGIN: "https://node.example.test",
                ...extraEnvironment,
              },
            },
          );
        const run = (...arguments_) => runWithEnvironment({}, ...arguments_);
        const exposureArguments = mode === "funnel" ? ["funnel", "--confirm-public"] : ["serve"];

        if (mode === "funnel") {
          const unconfirmed = await run("funnel");
          assert.notEqual(unconfirmed.status, 0);
          assert.match(unconfirmed.stderr, /Funnel is public and Rhasia sign-in is disabled/u);
          assert.equal(readFileIfExists(fakeLogPath), "");
        }

        writeTailscaleEnvironment(root, healthPort, "passwordless");
        const wrongAuthBackend = await run(...exposureArguments);
        assert.notEqual(wrongAuthBackend.status, 0);
        assert.match(wrongAuthBackend.stderr, /AUTH_TRUST_PROXY_HEADERS must be true when AUTH_BACKEND=passwordless/u);
        assert.equal(readFileIfExists(fakeLogPath), "");
        writeTailscaleEnvironment(root, healthPort);

        const wrongHostBinding = await runWithEnvironment({ FAKE_DOCKER_HOST_IP: "0.0.0.0" }, ...exposureArguments);
        assert.notEqual(wrongHostBinding.status, 0);
        assert.match(wrongHostBinding.stderr, /publish only 3000\/tcp to 127\.0\.0\.1/u);
        assert.equal(readFileIfExists(fakeLogPath), "");

        const wrongPortBinding = await runWithEnvironment(
          { FAKE_DOCKER_HOST_PORT: String(healthPort + 1) },
          ...exposureArguments,
        );
        assert.notEqual(wrongPortBinding.status, 0);
        assert.match(wrongPortBinding.stderr, /APP_PORT configured in \.env/u);
        assert.equal(readFileIfExists(fakeLogPath), "");

        const wrongWebOrigin = await runWithEnvironment(
          { FAKE_DOCKER_WEB_ORIGIN: "https://stale.example.test" },
          ...exposureArguments,
        );
        assert.notEqual(wrongWebOrigin.status, 0);
        assert.match(wrongWebOrigin.stderr, /running Web container must use WEB_ORIGIN=https:\/\/node\.example\.test/u);
        assert.equal(readFileIfExists(fakeLogPath), "");

        const wrongApiOrigin = await runWithEnvironment(
          { FAKE_DOCKER_API_ORIGIN: "https://stale.example.test" },
          ...exposureArguments,
        );
        assert.notEqual(wrongApiOrigin.status, 0);
        assert.match(wrongApiOrigin.stderr, /running API container must use WEB_ORIGIN=https:\/\/node\.example\.test/u);
        assert.equal(readFileIfExists(fakeLogPath), "");

        const wrongWebAuth = await runWithEnvironment({ FAKE_DOCKER_WEB_AUTH: "proxy" }, ...exposureArguments);
        assert.notEqual(wrongWebAuth.status, 0);
        assert.match(wrongWebAuth.stderr, /running Web container must use AUTH_BACKEND=none/u);
        assert.equal(readFileIfExists(fakeLogPath), "");

        const wrongApiAuth = await runWithEnvironment({ FAKE_DOCKER_API_AUTH: "" }, ...exposureArguments);
        assert.notEqual(wrongApiAuth.status, 0);
        assert.match(wrongApiAuth.stderr, /running API container must use AUTH_BACKEND=none/u);
        assert.equal(readFileIfExists(fakeLogPath), "");

        healthStatus = 403;
        const rejectedHealthCheck = await run(...exposureArguments);
        assert.notEqual(rejectedHealthCheck.status, 0);
        assert.match(rejectedHealthCheck.stderr, /health endpoint returned HTTP 403/u);
        assert.equal(readFileIfExists(fakeLogPath), "");
        healthStatus = 200;
        transientHealthStatuses = [503, 200];

        const enabled = await run(mode, ...(mode === "funnel" ? ["--confirm-public"] : []));
        assert.equal(enabled.status, 0, enabled.stderr);
        assert.match(enabled.stdout, new RegExp(`${mode} enabled at https://node\\.example\\.test`, "iu"));
        assert.match(enabled.stdout, /Rhasia application sign-in is disabled/u);
        if (mode === "funnel") {
          assert.match(enabled.stdout, /publicly reachable without Rhasia sign-in/u);
        }
        const statePath = join(root, ".tailscale-rhasia.json");
        const state = JSON.parse(readFileSync(statePath, "utf8"));
        assert.equal(state.mode, mode);
        assert.equal(state.target, `http://127.0.0.1:${healthPort}`);
        assert.equal(statSync(statePath).mode & 0o777, 0o600);

        const status = await run("status");
        assert.equal(status.status, 0, status.stderr);
        assert.match(status.stdout, new RegExp(`https://node\\.example\\.test`, "u"));

        const activeStatusSource = readFileSync(fakeStatusPath, "utf8");
        const changedModeStatus = JSON.parse(activeStatusSource);
        changedModeStatus.AllowFunnel = mode === "serve" ? { "node.example.test:443": true } : {};
        writeFileSync(fakeStatusPath, JSON.stringify(changedModeStatus));
        const refusedDisable = await run("off");
        assert.notEqual(refusedDisable.status, 0);
        assert.equal(existsSync(statePath), true);
        writeFileSync(fakeStatusPath, activeStatusSource);

        const disabled = await run("off");
        assert.equal(disabled.status, 0, disabled.stderr);
        assert.equal(readFileIfExists(statePath), "");
        const commands = readFileSync(fakeLogPath, "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line));
        assert.ok(
          commands.some(
            (command) =>
              command[0] === mode &&
              command.includes("--https=443") &&
              command.includes(state.target) &&
              command.includes("off"),
          ),
        );
        assert.equal(
          commands.some((command) => command.includes("reset")),
          false,
        );

        writeTailscaleEnvironment(root, healthPort, "passwordless", "true");
        const passwordlessDockerEnvironment = {
          FAKE_DOCKER_WEB_BACKEND: "passwordless",
          FAKE_DOCKER_API_BACKEND: "passwordless",
          FAKE_DOCKER_PROXY_TRUST: "true",
        };
        const commandsBeforePasswordlessChecks = readFileIfExists(fakeLogPath);
        writeTailscaleEnvironment(root, healthPort, "passwordless", "true", "https://stale.example.test");
        const mismatchedPasswordlessAuthOrigin = await runWithEnvironment(
          passwordlessDockerEnvironment,
          ...exposureArguments,
        );
        assert.notEqual(mismatchedPasswordlessAuthOrigin.status, 0);
        assert.match(mismatchedPasswordlessAuthOrigin.stderr, /AUTH_APP_ORIGIN must match WEB_ORIGIN/u);
        assert.equal(readFileIfExists(fakeLogPath), commandsBeforePasswordlessChecks);

        writeTailscaleEnvironment(root, healthPort, "passwordless", "true");
        const staleWebAuthOrigin = await runWithEnvironment(
          { ...passwordlessDockerEnvironment, FAKE_DOCKER_WEB_AUTH_ORIGIN: "https://stale.example.test" },
          ...exposureArguments,
        );
        assert.notEqual(staleWebAuthOrigin.status, 0);
        assert.match(
          staleWebAuthOrigin.stderr,
          /running Web container must use AUTH_APP_ORIGIN=https:\/\/node\.example\.test/u,
        );
        assert.equal(readFileIfExists(fakeLogPath), commandsBeforePasswordlessChecks);

        const staleApiAuthOrigin = await runWithEnvironment(
          { ...passwordlessDockerEnvironment, FAKE_DOCKER_API_AUTH_ORIGIN: "https://stale.example.test" },
          ...exposureArguments,
        );
        assert.notEqual(staleApiAuthOrigin.status, 0);
        assert.match(
          staleApiAuthOrigin.stderr,
          /running API container must use AUTH_APP_ORIGIN=https:\/\/node\.example\.test/u,
        );
        assert.equal(readFileIfExists(fakeLogPath), commandsBeforePasswordlessChecks);

        const unconfirmedPasswordlessFunnel = await runWithEnvironment(passwordlessDockerEnvironment, "funnel");
        assert.notEqual(unconfirmedPasswordlessFunnel.status, 0);
        assert.match(unconfirmedPasswordlessFunnel.stderr, /passwordless sign-in protects hosted features/u);

        const enabledPasswordless = await runWithEnvironment(
          passwordlessDockerEnvironment,
          mode,
          ...(mode === "funnel" ? ["--confirm-public"] : []),
        );
        assert.equal(enabledPasswordless.status, 0, enabledPasswordless.stderr);
        assert.match(enabledPasswordless.stdout, /passwordless sign-in is enabled/u);
        if (mode === "funnel") {
          assert.match(enabledPasswordless.stdout, /hosted Vault features remain protected by passwordless sign-in/u);
        }
        const disabledPasswordless = await run("off");
        assert.equal(disabledPasswordless.status, 0, disabledPasswordless.stderr);
        assert.equal(readFileIfExists(join(root, ".tailscale-rhasia.json")), "");
      } finally {
        await new Promise((resolve) => healthServer.close(resolve));
        rmSync(root, { recursive: true, force: true });
      }
    });
  }
});

function requestWizard(url, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(url, { method, headers }, (response) => {
      let responseBody = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => (responseBody += chunk));
      response.on("end", () =>
        resolve({
          status: response.statusCode,
          headers: new Map(
            Object.entries(response.headers).map(([key, value]) => [
              key,
              Array.isArray(value) ? value.join("; ") : (value ?? ""),
            ]),
          ),
          body: responseBody,
        }),
      );
    });
    request.on("error", reject);
    if (body) request.write(body);
    request.end();
  });
}

function writeTailscaleEnvironment(
  root,
  port,
  authBackend = "none",
  proxyTrust = "false",
  authAppOrigin = "https://node.example.test",
) {
  const envSource = [
    "POSTGRES_PASSWORD=synthetic-database-password",
    `PROXY_SECRET=${"p".repeat(32)}`,
    `API_PROXY_SECRET=${"p".repeat(32)}`,
    `CRON_SECRET=${"c".repeat(32)}`,
    `AUTH_BACKEND=${authBackend}`,
    "WEB_ORIGIN=https://node.example.test",
    "API_ORIGIN=http://localhost:8787",
    `AUTH_APP_ORIGIN=${authAppOrigin}`,
    `AUTH_TRUST_PROXY_HEADERS=${proxyTrust}`,
    "APP_BIND_ADDRESS=127.0.0.1",
    `APP_PORT=${port}`,
  ].join("\n");
  writeFileSync(join(root, ".env"), `${envSource}\n`, { mode: 0o600 });
}

function readFileIfExists(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return "";
    throw error;
  }
}

function runProcess(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    child.once("error", reject);
    child.once("close", (status) => resolve({ status, stdout, stderr }));
  });
}

const fakeTailscaleProgram = `#!/usr/bin/env node
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const statePath = process.env.FAKE_TAILSCALE_STATUS;
if (args[0] === "version") {
  process.stdout.write("1.102.4\\n");
} else if (args[0] === "status" && args[1] === "--json") {
  process.stdout.write(JSON.stringify({ BackendState: "Running", Self: { DNSName: "node.example.test." } }));
} else if ((args[0] === "serve" || args[0] === "funnel") && args[1] === "status") {
  process.stdout.write(existsSync(statePath) ? readFileSync(statePath, "utf8") : "{}");
  } else if (args[0] === "serve" || args[0] === "funnel") {
  appendFileSync(process.env.FAKE_TAILSCALE_LOG, JSON.stringify(args) + "\\n");
  if (args.includes("off")) {
    writeFileSync(statePath, "{}");
  } else {
    const port = process.env.FAKE_APP_PORT;
    const hostname = "node.example.test";
    const hostPort = hostname + ":443";
    writeFileSync(statePath, JSON.stringify({
      TCP: { "443": { HTTPS: true } },
      Web: { [hostPort]: { Handlers: { "/": { Proxy: "http://127.0.0.1:" + port } } } },
      AllowFunnel: args[0] === "funnel" ? { [hostPort]: true } : {},
    }));
  }
} else {
  process.exitCode = 1;
}
`;

const fakeDockerProgram = `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === "ps") {
  const service = args.find((argument) => argument.startsWith("label=com.docker.compose.service="));
  process.stdout.write(service === "label=com.docker.compose.service=api" ? "synthetic-api-container\\n" : "synthetic-web-container\\n");
} else if (args[0] === "inspect") {
  const format = args[2];
  if (format === "{{json .NetworkSettings.Ports}}") {
    const ports = {
      "3000/tcp": [{ HostIp: process.env.FAKE_DOCKER_HOST_IP || "127.0.0.1", HostPort: process.env.FAKE_DOCKER_HOST_PORT }],
    };
    process.stdout.write(JSON.stringify(ports) + "\\n");
  } else {
    const isWeb = args[3] === "synthetic-web-container";
    if (isWeb && process.env.FAKE_DOCKER_WEB_AUTH !== undefined) {
      process.stdout.write(process.env.FAKE_DOCKER_WEB_AUTH);
    } else if (!isWeb && process.env.FAKE_DOCKER_API_AUTH === "") {
      process.stdout.write("");
    } else {
      const actualEnvironment = isWeb
        ? {
            AUTH_BACKEND: process.env.FAKE_DOCKER_WEB_BACKEND,
            AUTH_TRUST_PROXY_HEADERS: process.env.FAKE_DOCKER_PROXY_TRUST,
            WEB_ORIGIN: process.env.FAKE_DOCKER_WEB_ORIGIN,
            AUTH_APP_ORIGIN: process.env.FAKE_DOCKER_WEB_AUTH_ORIGIN,
          }
        : {
            AUTH_BACKEND: process.env.FAKE_DOCKER_API_BACKEND,
            WEB_ORIGIN: process.env.FAKE_DOCKER_API_ORIGIN,
            AUTH_APP_ORIGIN: process.env.FAKE_DOCKER_API_AUTH_ORIGIN,
          };
      const expectedEnvironment = [...format.matchAll(/eq \. "([^"]+)"/gu)].map((match) => match[1]);
      const matchingEnvironment = expectedEnvironment
        .filter((entry) => {
          const separator = entry.indexOf("=");
          return actualEnvironment[entry.slice(0, separator)] === entry.slice(separator + 1);
        })
        .map((entry) => entry.slice(0, entry.indexOf("=")) + ";")
        .join("");
      process.stdout.write(matchingEnvironment);
    }
  }
} else {
  process.exitCode = 1;
}
`;
