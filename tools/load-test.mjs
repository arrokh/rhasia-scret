import { createHash, randomBytes, X509Certificate } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT_PREFIX = "rhasia-load-";
const PROJECT_PATTERN = /^rhasia-load-[0-9a-f]{12,32}$/;
const WEB_ORIGIN = "http://localhost:4000";
const MAILPIT_ORIGIN = "http://localhost:8025";
const DATABASE_NAME = "loadtest_vault";
const DISPOSABLE_DATABASE_OPERATIONS = new Set([
  "test:loadtest-stack-create",
  "test:loadtest-stack",
  "test:loadtest-migration",
  "test:loadtest-scenario",
  "test:loadtest-session-pool",
  "test:loadtest-shared-vault-fixtures",
  "test:loadtest-shared-mutation-fixtures",
  "test:loadtest-teardown",
]);
export const LOADTEST_RESOURCE_PROFILE = "capped-local-v1";
export const LOADTEST_SERVICE_RESOURCE_LIMITS = Object.freeze({
  db: Object.freeze({ cpus: "2.0", memory: "3g" }),
  migrate: Object.freeze({ cpus: "2.0", memory: "2g" }),
  api: Object.freeze({ cpus: "1.5", memory: "2g" }),
  web: Object.freeze({ cpus: "2.0", memory: "2g" }),
  "retention-purge": Object.freeze({ cpus: "0.25", memory: "256m" }),
  mailpit: Object.freeze({ cpus: "0.5", memory: "512m" }),
});
const BROWSER_HELPER_FAILURE_PHASES = new Set([
  "input_validation",
  "web_health_check",
  "browser_launch",
  "browser_context_creation",
  "browser_page_creation",
  "session_context_close",
  "mailpit_initial_clear",
  "sign_in_page_navigation",
  "email_form_fill",
  "email_form_hydration",
  "turnstile_ready",
  "magic_link_request_submit",
  "magic_link_request_response",
  "request_response_timeout",
  "request_not_dispatched",
  "request_unexpected_endpoint",
  "request_client_alert",
  "request_offline_client_alert",
  "request_client_status",
  "request_response_invalid_request",
  "request_response_turnstile_failed",
  "request_response_turnstile_unavailable",
  "request_response_rate_limit_unavailable",
  "request_response_rate_limited",
  "request_response_email_delivery_failed",
  "request_response_forbidden",
  "request_response_server_error",
  "request_response_rejected",
  "request_response_unexpected",
  "request_confirmation",
  "magic_link_email_wait",
  "magic_link_redemption",
  "personal_vault_setup",
  "personal_vault_creation",
  "personal_vault_unlock",
  "synthetic_account_creation",
  "session_read",
  "first_time_summary_missing",
  "first_time_browser_not_started",
  "first_time_sign_in_page_not_loaded",
  "first_time_sign_in_form_input_failed",
  "first_time_sign_in_form_blur_failed",
  "first_time_sign_in_form_not_hydrated",
  "first_time_email_typing_failed",
  "first_time_email_input_failed",
  "first_time_email_blur_failed",
  "first_time_email_validation_not_observed",
  "first_time_email_not_retained",
  "first_time_email_focus_failed",
  "first_time_email_focus_move_failed",
  "first_time_email_not_validated",
  "first_time_turnstile_not_ready",
  "first_time_passwordless_request_not_submitted",
  "first_time_passwordless_request_not_confirmed",
  "first_time_magic_link_mailpit_list_unavailable",
  "first_time_magic_link_mailpit_list_invalid",
  "first_time_magic_link_message_not_found",
  "first_time_magic_link_message_id_invalid",
  "first_time_magic_link_detail_unavailable",
  "first_time_magic_link_detail_invalid",
  "first_time_magic_link_link_missing",
  "first_time_magic_link_url_parse_failed",
  "first_time_magic_link_origin_mismatch",
  "first_time_magic_link_path_mismatch",
  "first_time_magic_link_token_missing",
  "first_time_magic_link_url_validation_incomplete",
  "first_time_magic_link_mailbox_cleanup_failed",
  "first_time_magic_link_not_captured",
  "first_time_magic_link_not_redeemed",
  "first_time_vault_name_not_filled",
  "first_time_custom_passphrase_not_selected",
  "first_time_custom_passphrase_not_filled",
  "first_time_custom_passphrase_form_state_invalid",
  "first_time_custom_passphrase_form_state_probe_incomplete",
  "first_time_passphrase_confirmation_not_filled",
  "first_time_setup_acknowledgement_not_checked",
  "first_time_vault_setup_submit_not_enabled",
  "first_time_vault_setup_submit_probe_not_started",
  "first_time_vault_setup_submit_button_missing",
  "first_time_vault_setup_submit_probe_incomplete",
  "first_time_vault_setup_submit_busy",
  "first_time_vault_setup_custom_mode_not_selected",
  "first_time_vault_setup_submit_disabled_unclassified",
  "first_time_vault_setup_not_submitted",
  "first_time_vault_initialization_client_crypto_failure",
  "first_time_vault_initialization_invalid_request",
  "first_time_vault_initialization_unauthenticated",
  "first_time_vault_initialization_forbidden",
  "first_time_vault_initialization_conflict",
  "first_time_vault_initialization_rate_limited",
  "first_time_vault_initialization_server_error",
  "first_time_vault_initialization_unexpected_response",
  "first_time_vault_initialization_transport_error",
  "first_time_vault_initialization_request_failure",
  "first_time_vault_initialization_post_failure",
  "first_time_vault_initialization_failure_unclassified",
  "first_time_vault_setup_validation_vault_name_invalid",
  "first_time_vault_setup_validation_passphrase_invalid",
  "first_time_vault_setup_validation_confirmation_invalid",
  "first_time_vault_setup_validation_acknowledgement_invalid",
  "first_time_vault_initialization_rejected",
  "first_time_vault_not_initialized",
  "first_time_vault_initialization_still_pending",
  "first_time_vault_setup_diagnostic_probe_incomplete",
  "first_time_vault_not_unlocked",
  "first_time_account_creation_link_not_visible",
  "first_time_account_creation_not_opened",
  "first_time_manual_uri_section_not_opened",
  "first_time_manual_uri_not_filled",
  "first_time_manual_uri_submit_not_enabled",
  "first_time_manual_uri_submit_not_clicked",
  "first_time_account_review_form_not_visible",
  "first_time_account_save_not_enabled",
  "first_time_account_not_created",
  "first_time_otp_not_rendered",
  "first_time_assertion_block_not_reached",
  "first_time_assertion_block_incomplete",
  "first_time_check_observations_missing",
  "first_time_assertions_failed",
  "rate_limit_summary_missing",
  "rate_limit_boundary_unsupported",
  "rate_limit_boundary_observations_missing",
  "rate_limit_boundary_attempt_count_mismatch",
  "rate_limit_boundary_admitted_count_mismatch",
  "rate_limit_boundary_limited_count_mismatch",
  "mailpit_final_clear",
  "browser_close",
  "helper_cancelled",
  "helper_timeout",
  "helper_output_limit",
  "helper_process_start",
  "helper_failed_unclassified",
  "helper_output_validation",
  "shared_web_health_check",
  "shared_browser_launch",
  "shared_mailpit_initial_clear",
  "shared_mutation_owner_session_preparation",
  "shared_mutation_vault_creation",
  "shared_mutation_context_close",
  "shared_owner_session_preparation",
  "shared_owner_vault_creation",
  "shared_member_session_preparation",
  "shared_invitation_creation",
  "shared_invitation_redemption",
  "shared_member_context_close",
  "shared_mailpit_final_clear",
  "shared_fixture_cleanup",
  "shared_fixture_output",
  "shared_management_navigation",
  "shared_creation_link",
  "shared_creation_form_fill",
  "shared_creation_submit",
  "shared_creation_response",
  "shared_creation_not_dispatched",
  "shared_creation_response_timeout",
  "shared_creation_validation_rejected",
  "shared_creation_unauthenticated",
  "shared_creation_forbidden",
  "shared_creation_conflict",
  "shared_creation_rate_limited",
  "shared_creation_server_error",
  "shared_creation_unexpected_status",
  "shared_creation_confirmation",
  "shared_creation_account_navigation",
  "shared_creation_account_form",
  "shared_creation_management_reload",
  "shared_creation_unlock_state",
  "shared_creation_unlock_state_timeout",
  "shared_creation_unlock_input",
  "shared_creation_unlock_hydration",
  "shared_creation_unlock_submit",
  "shared_creation_unlock_confirmation",
  "shared_creation_unlock_alert",
  "shared_creation_unlock_input_rejected",
  "shared_creation_unlock_alert_without_input",
  "shared_creation_unlock_workspace_omitted_vault",
  "shared_creation_unlock_membership_missing",
  "shared_creation_unlock_authentication_failure",
  "shared_creation_unlock_authorization_failure",
  "shared_creation_unlock_tabs_unavailable",
  "shared_creation_unlock_timeout",
  "shared_creation_unlock_authentication_failure",
  "shared_creation_unlock_cryptographic_failure",
  "shared_creation_unlock_passphrase_rejected",
  "shared_creation_unlock_sync_failure",
  "shared_creation_unlock_workspace_failure",
  "shared_creation_unlock_profile_failure",
  "shared_creation_unlock_identity_failure",
  "shared_creation_unlock_other_known_failure",
  "shared_creation_complete",
  "shared_invitation_tab",
  "shared_invitation_tab_unavailable",
  "shared_invitation_tablist_missing",
  "shared_invitation_tab_not_found",
  "shared_invitation_tab_hidden",
  "shared_invitation_tab_click",
  "shared_invitation_tab_click_failed",
  "shared_invitation_tab_disabled",
  "shared_invitation_form",
  "shared_invitation_input",
  "shared_invitation_submit",
  "shared_invitation_submit_request_observed",
  "shared_invitation_recipient_rejected",
  "shared_invitation_submit_button_missing",
  "shared_invitation_submit_button_hidden",
  "shared_invitation_submit_button_disabled",
  "shared_invitation_submit_multiple_buttons",
  "shared_invitation_submit_button_outside_viewport",
  "shared_invitation_submit_button_detached",
  "shared_invitation_submit_button_unstable",
  "shared_invitation_submit_click_intercepted",
  "shared_invitation_submit_click_timeout",
  "shared_invitation_submit_click_failed",
  "shared_invitation_response",
  "shared_invitation_response_timeout",
  "shared_invitation_not_dispatched",
  "shared_invitation_controls_form_mismatch",
  "shared_invitation_creation_error_alert",
  "shared_invitation_submit_still_pending",
  "shared_invitation_recipient_native_invalid",
  "shared_invitation_event_probe_unavailable",
  "shared_invitation_request_target_mismatch",
  "shared_invitation_submit_event_no_request",
  "shared_invitation_request_submit_not_observed",
  "shared_invitation_keyboard_event_not_observed",
  "shared_invitation_button_click_no_submit",
  "shared_invitation_enter_without_submit",
  "shared_invitation_activation_not_observed",
  "shared_invitation_validation_rejected",
  "shared_invitation_unauthenticated",
  "shared_invitation_forbidden",
  "shared_invitation_not_found",
  "shared_invitation_conflict",
  "shared_invitation_rate_limited",
  "shared_invitation_server_error",
  "shared_invitation_unexpected_status",
  "shared_invitation_confirmation",
  "shared_invitation_link_unavailable",
  "shared_invitation_link_invalid",
  "shared_invitation_complete",
]);
const K6_VERSION = "0.57.0";
const MAX_MIGRATION_STATS_SAMPLES = 600;
const COMPOSE_FILES = [path.join(ROOT, "docker-compose.yml"), path.join(ROOT, "docker-compose.loadtest.yml")];
const SCENARIOS = new Map([
  ["returning-personal", "personal-vault.js"],
  ["account-mutations", "account-mutations.js"],
  ["browser-smoke", "browser-smoke.js"],
  ["rate-limits", "rate-limits.js"],
  ["first-time", "browser-flows.js"],
  ["shared-vault", "shared-vault.js"],
  ["shared-account-mutations", "shared-account-mutations.js"],
]);
const VALUE_OPTIONS = new Set([
  "project",
  "target",
  "confirm-migration",
  "confirm-target",
  "scenario",
  "boundary",
  "max-vus",
  "duration",
  "runner-placement",
]);
const BOOLEAN_OPTIONS = new Set(["preserve-on-failure", "keep-stack"]);
const SAFE_PROCESS_ENVIRONMENT = [
  "PATH",
  "HOME",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "PLAYWRIGHT_BROWSERS_PATH",
  "XDG_CACHE_HOME",
  "XDG_RUNTIME_DIR",
  "LD_LIBRARY_PATH",
  "DYLD_LIBRARY_PATH",
  "DISPLAY",
  "WAYLAND_DISPLAY",
];

export class LoadTestError extends Error {
  constructor(message, failurePhaseDetail = null) {
    super(message);
    this.name = "LoadTestError";
    this.failurePhaseDetail = BROWSER_HELPER_FAILURE_PHASES.has(failurePhaseDetail) ? failurePhaseDetail : null;
  }
}

function createCancellation(onCancel) {
  const controller = new AbortController();
  const cancel = () => {
    if (controller.signal.aborted) return;
    controller.abort();
    onCancel();
  };
  process.on("SIGINT", cancel);
  process.on("SIGTERM", cancel);
  return {
    signal: controller.signal,
    dispose: () => {
      process.removeListener("SIGINT", cancel);
      process.removeListener("SIGTERM", cancel);
    },
  };
}

function assertNotAborted(signal) {
  if (signal.aborted)
    throw new LoadTestError("Load-test operation was cancelled; run-owned resources are being cleaned up.");
}

export function validateTarget(target) {
  if (typeof target !== "string" || target.length === 0) throw new LoadTestError("An explicit target is required.");
  let url;
  try {
    url = new URL(target);
  } catch {
    throw new LoadTestError("The target must be the run-owned http://localhost:4000 origin.");
  }
  if (
    url.protocol !== "http:" ||
    url.hostname !== "localhost" ||
    url.port !== "4000" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.origin !== WEB_ORIGIN
  )
    throw new LoadTestError("The target must be exactly the run-owned http://localhost:4000 origin.");
  return url.origin;
}

export function validateProject(project) {
  if (typeof project !== "string" || !PROJECT_PATTERN.test(project) || project === "rhasia-scret-selfhosted")
    throw new LoadTestError("The Compose project must be a generated rhasia-load-<12 hex> run ID.");
  return project;
}

export function validateMigrationConfirmation(project, databaseName, confirmation) {
  const expected = `${validateProject(project)}/${databaseName}`;
  if (confirmation !== expected)
    throw new LoadTestError(`Migration requires the exact disposable target confirmation: ${expected}`);
  return expected;
}

export function validateHighCeiling(maxVus, confirmation) {
  if (typeof maxVus !== "string" || !/^(?:[1-9]|1[0-9]|20)$/.test(maxVus))
    throw new LoadTestError(
      "The VU ceiling must be an integer from 1 to 20 for the isolated 20-request network budget.",
    );
  const value = Number(maxVus);
  if (value > 10 && confirmation !== String(value))
    throw new LoadTestError("A ceiling above 10 VUs requires --confirm-high-vus with the exact ceiling.");
  return value;
}

function parseArguments(argv) {
  const [command, ...rest] = argv;
  if (!command || command === "help" || command === "--help" || command === "-h")
    return { command: "help", options: {} };
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (!argument.startsWith("--")) throw new LoadTestError("Unexpected positional argument.");
    const name = argument.slice(2);
    if (BOOLEAN_OPTIONS.has(name)) {
      if (options[name] !== undefined) throw new LoadTestError("Duplicate command option.");
      options[name] = true;
      continue;
    }
    if (!VALUE_OPTIONS.has(name) && name !== "confirm-high-vus") throw new LoadTestError("Unknown command option.");
    if (options[name] !== undefined || rest[index + 1] === undefined || rest[index + 1].startsWith("--"))
      throw new LoadTestError("Every command option must have exactly one value.");
    options[name] = rest[index + 1];
    index += 1;
  }
  return { command, options };
}

function requiredOption(options, name) {
  if (typeof options[name] !== "string" || options[name].length === 0)
    throw new LoadTestError(`Missing required --${name}.`);
  return options[name];
}

function createDisposableRunId(dockerContext) {
  const result = spawnSync(
    process.execPath,
    [path.join(ROOT, "tools/confirm-database-operation.mjs"), "--new-disposable-run-id", "rhasia-load"],
    {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...cleanHostEnvironment(), DOCKER_CONTEXT: dockerContext },
      stdio: ["ignore", "pipe", "ignore"],
    },
  );
  if (result.error || result.status !== 0)
    throw new LoadTestError("A fresh local disposable run ID could not be verified.");
  const runId = (result.stdout ?? "").trim();
  if (!/^[0-9a-f]{16}$/.test(runId))
    throw new LoadTestError("The disposable run ID was not a bounded 16-character value.");
  return runId;
}

function loadTestResourceProfileEnvironment() {
  return Object.fromEntries(
    Object.entries(LOADTEST_SERVICE_RESOURCE_LIMITS).flatMap(([service, limits]) => {
      const key = service.toUpperCase().replaceAll("-", "_");
      return [
        [`LOADTEST_${key}_CPUS`, limits.cpus],
        [`LOADTEST_${key}_MEMORY`, limits.memory],
      ];
    }),
  );
}

export function applyLoadTestResourceProfile(environment) {
  return Object.assign(environment, loadTestResourceProfileEnvironment());
}

function safeComposeEnvironment(project, state) {
  const environment = Object.fromEntries(
    SAFE_PROCESS_ENVIRONMENT.filter((name) => process.env[name]).map((name) => [name, process.env[name]]),
  );
  // Compose gives shell variables precedence over the private --env-file.
  applyLoadTestResourceProfile(environment);
  environment.COMPOSE_DISABLE_ENV_FILE = "1";
  environment.COMPOSE_PROJECT_NAME = project;
  environment.COMMIT_SHA = state.commit;
  environment.APP_BIND_ADDRESS = "127.0.0.1";
  environment.APP_PORT = "4000";
  environment.WEB_CONTAINER_PORT = "3000";
  environment.MAILPIT_PORT = "8025";
  environment.DOCKER_CONTEXT = state.dockerContext;
  for (const name of ["DOCKER_CONFIG", "SSH_AUTH_SOCK"]) {
    if (process.env[name]) environment[name] = process.env[name];
  }
  return environment;
}

function safeK6Environment(
  options,
  project,
  summaryPath,
  scenario,
  maxVus,
  duration,
  sessionPoolJson,
  sharedFixturesJson,
) {
  const environment = Object.fromEntries(
    SAFE_PROCESS_ENVIRONMENT.filter((name) => process.env[name]).map((name) => [name, process.env[name]]),
  );
  environment.K6_NO_USAGE_REPORT = "true";
  environment.K6_BROWSER_HEADLESS = "true";
  environment.LOADTEST_TARGET = validateTarget(requiredOption(options, "target"));
  environment.LOADTEST_MAILPIT_ORIGIN = MAILPIT_ORIGIN;
  environment.LOADTEST_PROJECT_ID = validateProject(project);
  environment.LOADTEST_SCENARIO = scenario;
  environment.LOADTEST_MAX_VUS = String(maxVus);
  environment.LOADTEST_DURATION = duration ?? "";
  environment.LOADTEST_BOUNDARY = options.boundary ?? "";
  environment.LOADTEST_SUMMARY_PATH = summaryPath;
  if (sessionPoolJson) environment.LOADTEST_SESSION_POOL = sessionPoolJson;
  if (sharedFixturesJson) environment.LOADTEST_SHARED_FIXTURES = sharedFixturesJson;
  environment.NO_PROXY = "localhost,127.0.0.1,::1";
  environment.no_proxy = environment.NO_PROXY;
  environment.K6_BROWSER_EXECUTABLE_PATH = chromiumExecutablePath();
  return environment;
}

function chromiumExecutablePath() {
  try {
    const requireFromWeb = createRequire(path.join(ROOT, "apps/web/package.json"));
    const executablePath = requireFromWeb("playwright").chromium.executablePath();
    if (!existsSync(executablePath)) throw new Error("missing");
    return executablePath;
  } catch {
    throw new LoadTestError(
      "Pinned Playwright Chromium is unavailable; install the web workspace Chromium browser first.",
    );
  }
}

function verifyK6Version() {
  const result = spawnSync("k6", ["version"], {
    encoding: "utf8",
    env: cleanHostEnvironment(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0)
    throw new LoadTestError(`Install k6 ${K6_VERSION} before running a load scenario.`);
  const version = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (!new RegExp(`\\bv${K6_VERSION.replaceAll(".", "\\.")}\\b`).test(version))
    throw new LoadTestError(`This suite requires exactly k6 ${K6_VERSION}.`);
  return `k6 v${K6_VERSION}`;
}

function verifyChromiumVersion() {
  const executable = chromiumExecutablePath();
  const result = spawnSync(executable, ["--version"], {
    encoding: "utf8",
    env: cleanHostEnvironment(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0)
    throw new LoadTestError("The pinned Playwright Chromium executable could not be inspected.");
  return `${result.stdout ?? result.stderr ?? ""}`.trim().slice(0, 100) || "Chromium version unavailable";
}

function cleanHostEnvironment() {
  const environment = Object.fromEntries(
    SAFE_PROCESS_ENVIRONMENT.filter((name) => process.env[name]).map((name) => [name, process.env[name]]),
  );
  if (process.env.DOCKER_CONFIG) environment.DOCKER_CONFIG = process.env.DOCKER_CONFIG;
  return environment;
}

function inspectDockerContext(requestedName) {
  const nameResult = requestedName
    ? { status: 0, stdout: requestedName }
    : spawnSync("docker", ["context", "show"], {
        encoding: "utf8",
        env: cleanHostEnvironment(),
        stdio: ["ignore", "pipe", "ignore"],
      });
  const name = (nameResult.stdout ?? "").trim();
  if (nameResult.status !== 0 || !/^[A-Za-z0-9._-]{1,64}$/.test(name))
    throw new LoadTestError("Select a named Docker context before creating a load-test run.");
  const environment = { ...cleanHostEnvironment(), DOCKER_CONTEXT: name };
  const inspected = spawnSync("docker", ["context", "inspect", name], {
    encoding: "utf8",
    env: environment,
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (inspected.status !== 0) throw new LoadTestError("The selected Docker context could not be inspected safely.");
  try {
    const [context] = JSON.parse(inspected.stdout ?? "");
    const endpoint = context?.Endpoints?.docker?.Host;
    if (typeof endpoint !== "string" || endpoint.length > 512) throw new Error("invalid-endpoint");
    let parsed;
    try {
      parsed = new URL(endpoint);
    } catch {
      throw new Error("invalid-endpoint");
    }
    const placement =
      parsed.protocol === "ssh:"
        ? "separate-runner"
        : ["unix:", "npipe:"].includes(parsed.protocol)
          ? "same-machine"
          : "unsupported";
    if (placement === "unsupported" || parsed.password || parsed.search || parsed.hash)
      throw new Error("unsupported-endpoint");
    const fingerprint = createHash("sha256").update(endpoint).digest("hex");
    if (placement === "separate-runner") {
      const username = decodeURIComponent(parsed.username);
      if (
        !/^[A-Za-z0-9._-]*$/.test(username) ||
        !(/^[A-Za-z0-9.-]+$/.test(parsed.hostname) || /^\[[0-9A-Fa-f:.]+\]$/.test(parsed.hostname)) ||
        (parsed.pathname !== "" && parsed.pathname !== "/")
      )
        throw new Error("invalid-ssh-endpoint");
      return { name, endpoint, fingerprint, placement, username, hostname: parsed.hostname, port: parsed.port };
    }
    return { name, endpoint, fingerprint, placement };
  } catch {
    throw new LoadTestError("The selected Docker context must use a local socket or an authenticated SSH endpoint.");
  }
}

function assertDockerContextMatches(state) {
  const context = inspectDockerContext(state.dockerContext);
  if (context.placement !== state.runnerPlacement || context.fingerprint !== state.dockerContextFingerprint)
    throw new LoadTestError("The selected Docker context changed after this run was created.");
  return context;
}

function gitWorkingTreeClean() {
  const result = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], {
    cwd: ROOT,
    encoding: "utf8",
    env: cleanHostEnvironment(),
    stdio: ["ignore", "pipe", "ignore"],
  });
  return result.status === 0 && (result.stdout ?? "").length === 0;
}

function gitCommit() {
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

function projectDirectory(project) {
  return path.join(os.tmpdir(), `rhasia-loadtest-${validateProject(project)}`);
}

function envFilePath(project) {
  return path.join(projectDirectory(project), "compose.env");
}

function stateFilePath(project) {
  return path.join(projectDirectory(project), "state.json");
}

function smtpCertificateFilePath(project) {
  return path.join(projectDirectory(project), "smtp-cert.pem");
}

function smtpPrivateKeyFilePath(project) {
  return path.join(projectDirectory(project), "smtp-key.pem");
}

function createSmtpTlsMaterial(project) {
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

function ensurePrivateDirectory(directory) {
  const details = lstatSync(directory);
  if (!details.isDirectory() || details.isSymbolicLink() || (details.mode & 0o077) !== 0)
    throw new LoadTestError("Run state directory is not private and regular.");
  if (typeof process.getuid === "function" && details.uid !== process.getuid())
    throw new LoadTestError("Run state directory is not owned by the current user.");
}

function readState(project) {
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

function isValidMigrationDockerPeak(value) {
  return (
    value === null ||
    (!!value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Number.isSafeInteger(value.sampleCount) &&
      value.sampleCount >= 1 &&
      value.sampleCount <= MAX_MIGRATION_STATS_SAMPLES &&
      typeof value.cpuPercent === "string" &&
      /^\d+(?:\.\d+)?%$/.test(value.cpuPercent) &&
      typeof value.memoryUsage === "string" &&
      /^\d+(?:\.\d+)?\s*[A-Za-z]+\s*\/\s*\d+(?:\.\d+)?\s*[A-Za-z]+$/.test(value.memoryUsage))
  );
}

function writeState(project, state) {
  const filePath = stateFilePath(project);
  const temporary = `${filePath}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  chmodSync(temporary, 0o600);
  rmSync(filePath, { force: true });
  writeFileSync(filePath, readFileSync(temporary), { flag: "wx", mode: 0o600 });
  rmSync(temporary, { force: true });
}

function generateEnvironment(project, commit, smtpCaBase64) {
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
    "WEB_CONTAINER_PORT=3000",
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

function composeArguments(project, state, args) {
  return [
    "compose",
    "--env-file",
    envFilePath(project),
    "--project-name",
    project,
    "-f",
    COMPOSE_FILES[0],
    "-f",
    COMPOSE_FILES[1],
    ...args,
  ];
}

function runCompose(project, state, args, { capture = false, timeout } = {}) {
  const result = spawnSync("docker", composeArguments(project, state, args), {
    cwd: ROOT,
    encoding: "utf8",
    env: safeComposeEnvironment(project, state),
    stdio: capture ? ["ignore", "pipe", "pipe"] : "ignore",
    ...(timeout ? { timeout } : {}),
  });
  if (result.error || result.status !== 0) throw new LoadTestError(`Docker Compose operation failed (${args[0]}).`);
  return capture ? result.stdout.trim() : "";
}

function verifyDisposableDatabaseOperation(project, state, operation) {
  const runId = project.slice(PROJECT_PREFIX.length);
  if (
    state.runnerPlacement !== "same-machine" ||
    !DISPOSABLE_DATABASE_OPERATIONS.has(operation) ||
    !/^[0-9a-f]{12,32}$/.test(runId)
  )
    throw new LoadTestError("The database operation does not match a supported local disposable scope.");

  const values = new Map();
  const requiredNames = new Set([
    "POSTGRES_DB",
    "POSTGRES_USER",
    "POSTGRES_PASSWORD",
    ...Object.keys(loadTestResourceProfileEnvironment()),
  ]);
  for (const line of readFileSync(envFilePath(project), "utf8").split(/\r?\n/)) {
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const name = line.slice(0, separator);
    if (!requiredNames.has(name)) continue;
    if (values.has(name)) throw new LoadTestError("The private database configuration is invalid.");
    values.set(name, line.slice(separator + 1));
  }
  const database = values.get("POSTGRES_DB");
  const username = values.get("POSTGRES_USER");
  const password = values.get("POSTGRES_PASSWORD");
  if (
    database !== DATABASE_NAME ||
    typeof username !== "string" ||
    !/^[A-Za-z0-9_.-]{1,64}$/.test(username) ||
    typeof password !== "string" ||
    !/^[0-9a-f]{64}$/.test(password) ||
    Object.entries(loadTestResourceProfileEnvironment()).some(([name, expected]) => values.get(name) !== expected)
  )
    throw new LoadTestError("The private database configuration is invalid.");

  const databaseUrl = `postgresql://${encodeURIComponent(username)}:${encodeURIComponent(password)}@db:5432/${database}?schema=public`;
  const environment = {
    ...cleanHostEnvironment(),
    DOCKER_CONTEXT: state.dockerContext,
    COMPOSE_PROJECT_NAME: project,
    RHSIA_DISPOSABLE_RUN_ID: runId,
    RHSIA_DISPOSABLE_DATA_CLASSIFICATION: "synthetic",
    DATABASE_URL: databaseUrl,
    DIRECT_URL: databaseUrl,
    POSTGRES_DB: database,
    POSTGRES_USER: username,
    POSTGRES_PASSWORD: password,
  };
  const verifierMode =
    operation === "test:loadtest-stack-create" ? "--verify-new-disposable-run-id" : "--disposable-run-id";
  const result = spawnSync(
    process.execPath,
    [path.join(ROOT, "tools/confirm-database-operation.mjs"), verifierMode, runId, operation],
    { cwd: ROOT, env: environment, stdio: "ignore" },
  );
  if (result.error || result.status !== 0)
    throw new LoadTestError("The run-owned database scope was not verified; refusing the operation.");
}

function startMailpitWithCertificate(project, state) {
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
  const stagedSource = path.join(projectDirectory(project), `smtp-stage-${randomBytes(6).toString("hex")}.pem`);
  try {
    // Docker copies as root; Mailpit runs unprivileged, so make this transient copy readable but not writable.
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
    rmSync(stagedSource, { force: true });
  }
}

async function createProject(options) {
  validateTarget(requiredOption(options, "target"));
  const context = inspectDockerContext();
  const runnerPlacement = validateRunnerPlacement(
    options["runner-placement"] ?? "same-machine",
    context,
    options["confirm-target"],
  );
  if (context.placement !== "same-machine")
    throw new LoadTestError("Run-owned disposable load-test databases require a local Docker context.");
  const project = `${PROJECT_PREFIX}${createDisposableRunId(context.name)}`;
  const commit = gitCommit();
  const directory = projectDirectory(project);
  mkdirSync(directory, { mode: 0o700 });
  try {
    chmodSync(directory, 0o700);
    const smtpTls = createSmtpTlsMaterial(project);
    const envFile = envFilePath(project);
    writeFileSync(envFile, generateEnvironment(project, commit, smtpTls.caBase64), { flag: "wx", mode: 0o600 });
    chmodSync(envFile, 0o600);
    const state = {
      project,
      target: WEB_ORIGIN,
      databaseName: DATABASE_NAME,
      commit,
      workingTreeCleanAtCreate: gitWorkingTreeClean(),
      k6Version: K6_VERSION,
      runnerPlacement,
      resourceProfile: LOADTEST_RESOURCE_PROFILE,
      dockerContext: context.name,
      dockerContextFingerprint: context.fingerprint,
      migrationCompleted: false,
      migrationDockerPeak: null,
      createdAt: new Date().toISOString(),
    };
    writeFileSync(stateFilePath(project), `${JSON.stringify(state, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    chmodSync(stateFilePath(project), 0o600);
    console.log(`project=${project}`);
    console.log(`target=${WEB_ORIGIN}`);
    console.log(`runner-placement=${runnerPlacement}`);
    console.log(`docker-context=${context.name}`);
    console.log(`migration-confirmation=${project}/${DATABASE_NAME}`);
    console.log("Run credentials are stored outside the repository with owner-only permissions.");
  } catch (error) {
    try {
      rmSync(directory, { recursive: true, force: true });
    } catch {
      throw new LoadTestError(`Run project ${project} setup failed and its private state could not be removed.`);
    }
    if (error instanceof LoadTestError) throw error;
    throw new LoadTestError("Run-owned private state could not be initialized safely.");
  }
}

export function parseMigrationDockerStats(output, project) {
  if (typeof output !== "string" || output.length > 8_192 || !PROJECT_PATTERN.test(project)) return [];
  const rows = [];
  for (const line of output.trim().split(/\r?\n/)) {
    const [name, cpuPercent, memoryUsage, memoryPercent, ...extra] = line.split("|");
    const prefix = `${project}-migrate-run-`;
    if (
      extra.length > 0 ||
      !name?.startsWith(prefix) ||
      !/^[0-9a-f]{12,64}$/.test(name.slice(prefix.length)) ||
      !/^\d+(?:\.\d+)?%$/.test(cpuPercent ?? "") ||
      !/^\d+(?:\.\d+)?\s*[A-Za-z]+\s*\/\s*\d+(?:\.\d+)?\s*[A-Za-z]+$/.test(memoryUsage ?? "") ||
      !/^\d+(?:\.\d+)?%$/.test(memoryPercent ?? "")
    )
      continue;
    const cpuPercentValue = Number(cpuPercent.slice(0, -1));
    const memoryMiB = dockerMemoryMiB(memoryUsage.split("/")[0]);
    if (!Number.isFinite(cpuPercentValue) || cpuPercentValue > 10_000 || memoryMiB === null) continue;
    rows.push({ cpuPercent, cpuPercentValue, memoryUsage: memoryUsage.trim(), memoryMiB });
    if (rows.length >= 1) break;
  }
  return rows;
}

function dockerMemoryMiB(value) {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*([A-Za-z]+)$/);
  if (!match) return null;
  const scales = { B: 1 / 1_048_576, KiB: 1 / 1_024, MiB: 1, GiB: 1_024, TiB: 1_048_576 };
  const scale = scales[match[2]];
  const valueMiB = Number(match[1]) * (scale ?? Number.NaN);
  return Number.isFinite(valueMiB) && valueMiB >= 0 ? valueMiB : null;
}

export function validateRunnerPlacement(placement, context, confirmation) {
  if (!["same-machine", "separate-runner"].includes(placement))
    throw new LoadTestError("Runner placement must be same-machine or separate-runner.");
  if (context.placement !== placement)
    throw new LoadTestError(
      "Runner placement must match a local Docker socket or the selected authenticated SSH Docker context.",
    );
  if (placement === "separate-runner") {
    if (!/^rhasia-loadtest-[a-z0-9-]{1,48}$/.test(context.name))
      throw new LoadTestError("Separate-runner mode requires a dedicated rhasia-loadtest-* SSH Docker context.");
    const expected = `${context.name}/${WEB_ORIGIN}/ssh-tunnel`;
    if (confirmation !== expected)
      throw new LoadTestError(`Separate-runner placement requires exact tunnel confirmation: ${expected}`);
  } else if (confirmation !== undefined) {
    throw new LoadTestError("--confirm-target is only valid for an explicitly confirmed SSH-tunnel run.");
  }
  return placement;
}

function validateRunnerPlacementOption(options, state) {
  if (options["runner-placement"] !== undefined && options["runner-placement"] !== state.runnerPlacement)
    throw new LoadTestError("Runner placement must match the run-owned Docker context.");
}

async function bringUp(options) {
  const project = validateProject(requiredOption(options, "project"));
  const target = validateTarget(requiredOption(options, "target"));
  const state = readState(project);
  validateRunnerPlacementOption(options, state);
  if (target !== state.target) throw new LoadTestError("The target does not match this run's Compose project.");
  assertDockerContextMatches(state);
  verifyDisposableDatabaseOperation(project, state, "test:loadtest-stack-create");
  let tunnel = null;
  let databaseStarted = false;
  const cancellation = createCancellation(() => stopRunnerTunnel(tunnel));
  try {
    tunnel = await startRunnerTunnel(state, cancellation.signal);
    assertNotAborted(cancellation.signal);
    runCompose(project, state, ["up", "--detach", "db"]);
    databaseStarted = true;
    verifyDisposableDatabaseOperation(project, state, "test:loadtest-stack");
    assertNotAborted(cancellation.signal);
    startMailpitWithCertificate(project, state);
    assertNotAborted(cancellation.signal);
    await waitForBootstrapServices(project, state, tunnel, cancellation.signal);
    runCompose(project, state, ["build", "api", "web", "retention-purge"]);
    runCompose(project, state, ["up", "--detach", "--no-build", "--pull", "never", "api", "web", "retention-purge"]);
    assertNotAborted(cancellation.signal);
    await waitForServices(project, state, tunnel, cancellation.signal);
    await verifySmtpPreflight(project, state, cancellation.signal);
    console.log("smtp-preflight=passed");
  } catch (error) {
    if (!options["preserve-on-failure"] && !options["keep-stack"]) {
      if (databaseStarted) {
        await teardown(project, state);
      } else {
        try {
          discardUnstartedProject(project, state);
        } catch {
          throw new LoadTestError(
            "Stack startup failed before PostgreSQL verification; run-owned resources were retained for safe inspection.",
          );
        }
      }
    }
    throw error;
  } finally {
    stopRunnerTunnel(tunnel);
    cancellation.dispose();
  }
  console.log(`ready=${target}`);
  console.log(`project=${project}`);
  console.log(`migration-required=${project}/${DATABASE_NAME}`);
}

async function waitForBootstrapServices(project, state, tunnel, signal) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    assertNotAborted(signal);
    assertRunnerTunnelAlive(tunnel);
    if ((await isHealthy(`${MAILPIT_ORIGIN}/`)) && isPostgresReady(project, state)) return;
    await delay(1_000);
  }
  throw new LoadTestError("The run-owned database or local SMTP capture service did not become healthy.");
}

async function waitForServices(project, state, tunnel, signal) {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    assertNotAborted(signal);
    assertRunnerTunnelAlive(tunnel);
    const webReady = await isHealthy(state.target + "/api/v1/health", true);
    const mailReady = await isHealthy(MAILPIT_ORIGIN + "/");
    const services = runCompose(project, state, ["ps", "--status", "running", "--services"], { capture: true })
      .split(/\r?\n/)
      .filter(Boolean);
    if (
      webReady &&
      mailReady &&
      ["db", "mailpit", "api", "web", "retention-purge"].every((name) => services.includes(name))
    )
      return;
    await delay(2_000);
  }
  throw new LoadTestError("The run-owned web, API, database, scheduler, or SMTP catcher did not become healthy.");
}

async function verifySmtpPreflight(project, state, signal) {
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

export function mailpitPreflightMessageCaptured(payload, expectedRecipient) {
  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    typeof expectedRecipient !== "string" ||
    !/^[^\s@]+@loadtest\.invalid$/.test(expectedRecipient) ||
    !Array.isArray(payload.messages) ||
    payload.messages.length !== 1
  )
    return false;
  const [message] = payload.messages;
  return (
    !!message &&
    typeof message === "object" &&
    Array.isArray(message.To) &&
    message.To.some(
      (recipient) =>
        recipient && typeof recipient.Address === "string" && recipient.Address.toLowerCase() === expectedRecipient,
    )
  );
}

export function mailpitMessageListIsEmpty(payload) {
  return (
    !!payload &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    Array.isArray(payload.messages) &&
    payload.messages.length === 0
  );
}

async function startRunnerTunnel(state, signal) {
  assertNotAborted(signal);
  const context = assertDockerContextMatches(state);
  if (state.runnerPlacement === "same-machine") return null;
  const destination = `${context.username ? `${context.username}@` : ""}${context.hostname}`;
  const args = [
    "-N",
    "-T",
    "-o",
    "BatchMode=yes",
    "-o",
    "ExitOnForwardFailure=yes",
    "-o",
    "StrictHostKeyChecking=yes",
    "-o",
    "ServerAliveInterval=30",
    "-o",
    "ServerAliveCountMax=3",
  ];
  if (context.port) args.push("-p", context.port);
  args.push("-L", "127.0.0.1:4000:127.0.0.1:4000", "-L", "127.0.0.1:8025:127.0.0.1:8025", destination);
  const environment = cleanHostEnvironment();
  if (process.env.SSH_AUTH_SOCK) environment.SSH_AUTH_SOCK = process.env.SSH_AUTH_SOCK;
  const child = spawn("ssh", args, { cwd: ROOT, env: environment, stdio: "ignore" });
  let spawnError = false;
  const tunnel = { child };
  const onAbort = () => stopRunnerTunnel(tunnel);
  signal.addEventListener("abort", onAbort, { once: true });
  child.once("close", () => signal.removeEventListener("abort", onAbort));
  child.once("error", () => {
    spawnError = true;
  });
  await delay(300);
  assertNotAborted(signal);
  if (spawnError || child.exitCode !== null || child.signalCode !== null)
    throw new LoadTestError("The authenticated run-local service tunnel could not be established.");
  return { child };
}

function assertRunnerTunnelAlive(tunnel) {
  if (tunnel && (tunnel.child.exitCode !== null || tunnel.child.signalCode !== null))
    throw new LoadTestError("The authenticated run-local service tunnel closed during the run.");
}

function stopRunnerTunnel(tunnel) {
  if (tunnel && tunnel.child.exitCode === null && tunnel.child.signalCode === null) tunnel.child.kill("SIGTERM");
}

async function waitForTargetHealth(tunnel, signal) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    assertNotAborted(signal);
    assertRunnerTunnelAlive(tunnel);
    if (await isHealthy(`${WEB_ORIGIN}/api/v1/health`, true)) return;
    await delay(1_000);
  }
  throw new LoadTestError("The run-owned web health check failed before the scenario started.");
}

async function isHealthy(url, sameOrigin = false) {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(2_000),
      redirect: "manual",
      ...(sameOrigin ? { headers: { origin: WEB_ORIGIN } } : {}),
    });
    return response.status >= 200 && response.status < 300;
  } catch {
    return false;
  }
}

function isPostgresReady(project, state) {
  try {
    runCompose(
      project,
      state,
      ["exec", "--no-TTY", "db", "pg_isready", "--quiet", "-U", "loadtest", "-d", DATABASE_NAME],
      {
        timeout: 5_000,
      },
    );
    return true;
  } catch {
    return false;
  }
}

function captureMigrationDockerStats(project, state) {
  const environment = safeComposeEnvironment(project, state);
  const containers = spawnSync(
    "docker",
    [
      "ps",
      "-q",
      "--filter",
      `label=com.docker.compose.project=${project}`,
      "--filter",
      "label=com.docker.compose.service=migrate",
    ],
    { encoding: "utf8", env: environment, stdio: ["ignore", "pipe", "ignore"] },
  );
  if (containers.error || containers.status !== 0) return [];
  const ids = (containers.stdout ?? "").trim().split(/\r?\n/).filter(Boolean);
  if (ids.length !== 1 || !/^[0-9a-f]{12,64}$/.test(ids[0])) return [];
  const result = spawnSync(
    "docker",
    ["stats", "--no-stream", "--format", "{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}", ids[0]],
    { encoding: "utf8", env: environment, stdio: ["ignore", "pipe", "ignore"] },
  );
  if (result.error || result.status !== 0) return [];
  return parseMigrationDockerStats(result.stdout ?? "", project);
}

function runMigrationWithStatsSampling(project, state) {
  const peak = { sampleCount: 0, maxCpuPercentValue: -1, cpuPercent: null, maxMemoryMiB: -1, memoryUsage: null };
  let sampling = false;
  const sample = () => {
    if (sampling || peak.sampleCount >= MAX_MIGRATION_STATS_SAMPLES) return;
    sampling = true;
    try {
      for (const row of captureMigrationDockerStats(project, state)) {
        peak.sampleCount += 1;
        if (row.cpuPercentValue > peak.maxCpuPercentValue) {
          peak.maxCpuPercentValue = row.cpuPercentValue;
          peak.cpuPercent = row.cpuPercent;
        }
        if (row.memoryMiB > peak.maxMemoryMiB) {
          peak.maxMemoryMiB = row.memoryMiB;
          peak.memoryUsage = row.memoryUsage;
        }
      }
    } catch {
      return;
    } finally {
      sampling = false;
    }
  };
  return new Promise((resolve, reject) => {
    const child = spawn("docker", composeArguments(project, state, ["run", "--build", "--rm", "migrate"]), {
      cwd: ROOT,
      env: safeComposeEnvironment(project, state),
      stdio: "ignore",
    });
    const interval = setInterval(sample, 250);
    let settled = false;
    const finish = (error, code) => {
      if (settled) return;
      settled = true;
      clearInterval(interval);
      sample();
      if (error) {
        reject(error);
        return;
      }
      if (code !== 0) {
        reject(new LoadTestError("Docker Compose operation failed (run)."));
        return;
      }
      resolve(
        peak.sampleCount > 0
          ? { sampleCount: peak.sampleCount, cpuPercent: peak.cpuPercent, memoryUsage: peak.memoryUsage }
          : null,
      );
    };
    child.once("error", () => finish(new LoadTestError("The isolated migration container could not start.")));
    child.once("close", (code) => finish(null, code ?? 1));
    sample();
  });
}

async function migrate(options) {
  const project = validateProject(requiredOption(options, "project"));
  const target = validateTarget(requiredOption(options, "target"));
  const confirmation = requiredOption(options, "confirm-migration");
  validateMigrationConfirmation(project, DATABASE_NAME, confirmation);
  const state = readState(project);
  validateRunnerPlacementOption(options, state);
  if (target !== state.target) throw new LoadTestError("The target does not match this run's Compose project.");
  assertDockerContextMatches(state);
  if (state.migrationCompleted) throw new LoadTestError("This fresh disposable database has already been migrated.");
  const services = runCompose(project, state, ["ps", "--status", "running", "--services"], { capture: true })
    .split(/\r?\n/)
    .filter(Boolean);
  if (!services.includes("db"))
    throw new LoadTestError("The exact run-owned PostgreSQL service must be running first.");
  verifyDisposableDatabaseOperation(project, state, "test:loadtest-migration");
  try {
    state.migrationDockerPeak = await runMigrationWithStatsSampling(project, state);
    state.migrationCompleted = true;
    state.migratedAt = new Date().toISOString();
    writeState(project, state);
  } catch (error) {
    if (!shouldPreserveFailedRun(options)) await teardown(project, state);
    throw error;
  }
  console.log(`migration=complete`);
  console.log(`database=${confirmation}`);
}

export function shouldPreserveFailedRun(options) {
  return options["preserve-on-failure"] === true || options["keep-stack"] === true;
}

export function validateFreshScenarioState(state) {
  if (state.loadScenarioStartedAt)
    throw new LoadTestError(
      "Each disposable database permits exactly one load scenario; create a fresh run for the next scenario or boundary group.",
    );
}

function validateRunReadiness(project, state, target) {
  if (target !== state.target) throw new LoadTestError("The target does not match this run's Compose project.");
  assertDockerContextMatches(state);
  validateFreshScenarioState(state);
  if (!state.migrationCompleted)
    throw new LoadTestError("Run the separately authorized disposable-database migration first.");
  const services = runCompose(project, state, ["ps", "--status", "running", "--services"], { capture: true })
    .split(/\r?\n/)
    .filter(Boolean);
  const required = ["db", "mailpit", "api", "web", "retention-purge"];
  if (!required.every((service) => services.includes(service)))
    throw new LoadTestError("The exact run-owned Compose project is not fully running.");
}

export function validateScenario(options, state) {
  const scenario = requiredOption(options, "scenario");
  if (scenario !== "rate-limits" && options.boundary !== undefined)
    throw new LoadTestError("--boundary is only valid for the rate-limits scenario.");
  if (
    scenario !== "capacity" &&
    [options["max-vus"], options.duration, options["confirm-high-vus"]].some((value) => value !== undefined)
  )
    throw new LoadTestError("Capacity ceiling and duration options are only valid for the capacity scenario.");
  if (scenario === "capacity") {
    if (state.runnerPlacement !== "separate-runner" && state.resourceProfile !== LOADTEST_RESOURCE_PROFILE)
      throw new LoadTestError("Same-machine capacity mode requires the bounded Compose resource profile.");
    const maxVus = validateHighCeiling(requiredOption(options, "max-vus"), options["confirm-high-vus"]);
    if (maxVus <= 10) throw new LoadTestError("Capacity mode requires an explicitly opted-in ceiling above 10 VUs.");
    const duration = requiredOption(options, "duration");
    const match = /^(\d+)(s|m)$/.exec(duration);
    const seconds = match ? Number(match[1]) * (match[2] === "m" ? 60 : 1) : 0;
    if (seconds < 1 || seconds > 600) throw new LoadTestError("Capacity duration must be from 1 second to 10 minutes.");
    return { scenario, script: SCENARIOS.get("returning-personal"), maxVus, duration };
  }
  const script = SCENARIOS.get(scenario);
  if (!script) throw new LoadTestError("Choose a supported load-test scenario.");
  if (scenario === "rate-limits" && !["email", "network", "authenticated"].includes(options.boundary))
    throw new LoadTestError("Rate-limit tests require --boundary email, network, or authenticated.");
  return { scenario, script, maxVus: 10, duration: "" };
}

function resultDirectory(project) {
  const directory = path.join(ROOT, "test-results", "load", validateProject(project));
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  return directory;
}

async function runScenario(options) {
  const project = validateProject(requiredOption(options, "project"));
  const target = validateTarget(requiredOption(options, "target"));
  const state = readState(project);
  validateRunnerPlacementOption(options, state);
  if (target !== state.target) throw new LoadTestError("The target does not match this run's Compose project.");
  assertDockerContextMatches(state);
  let configured;
  let k6Version;
  let chromiumVersion;
  let directory;
  try {
    validateRunReadiness(project, state, target);
    configured = validateScenario(options, state);
    k6Version = verifyK6Version();
    chromiumVersion = verifyChromiumVersion();
    directory = resultDirectory(project);
  } catch (error) {
    if (!shouldPreserveFailedRun(options)) await teardown(project, state);
    throw error;
  }
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
  const summaryPath = path.join(directory, `${configured.scenario}-${stamp}.summary.json`);
  const reportPath = path.join(directory, `${configured.scenario}-${stamp}.report.json`);
  const runRecord = {
    schemaVersion: 1,
    project,
    scenario: configured.scenario,
    target,
    boundary: options.boundary ?? null,
    runnerPlacement: state.runnerPlacement,
    resourceProfile: state.resourceProfile,
    serviceResourceLimits: LOADTEST_SERVICE_RESOURCE_LIMITS,
    migrationDockerPeak: state.migrationDockerPeak,
    networkPath:
      state.runnerPlacement === "separate-runner"
        ? "authenticated SSH forwards to run-owned host loopback ports 4000 and 8025"
        : "same-machine loopback",
    dockerContext: state.dockerContext,
    loadGenerator: machineSummary(),
    stackHost: stackHostSummary(project, state),
    gitCommit: state.commit,
    workingTreeCleanAtCreate: state.workingTreeCleanAtCreate,
    workingTreeCleanAtRun: gitWorkingTreeClean(),
    versions: { k6: k6Version, browserModule: `k6/browser bundled with ${k6Version}`, chromium: chromiumVersion },
    dockerSnapshots: [],
    postgresSnapshots: [],
    k6ProcessSnapshots: [],
    sshTunnelProcessSnapshots: [],
    profile: scenarioProfile(configured, options),
    preparedAt: new Date().toISOString(),
    scenarioStartedAt: null,
    failurePhase: null,
    failurePhaseDetail: null,
    stopReason: null,
    k6ExitCode: null,
    summary: null,
    applicationRateLimits: null,
  };
  state.loadScenario = configured.scenario;
  state.loadScenarioStartedAt = new Date().toISOString();
  writeState(project, state);
  let exitCode = 1;
  let tunnel = null;
  const cancellation = createCancellation(() => stopRunnerTunnel(tunnel));
  let resourceTimer;
  let sessionPoolJson = "";
  let sharedFixturesJson = "";
  let failurePhase = "runner_tunnel";
  try {
    tunnel = await startRunnerTunnel(state, cancellation.signal);
    failurePhase = "web_health_preflight";
    await waitForTargetHealth(tunnel, cancellation.signal);
    failurePhase = "postgres_health_preflight";
    if (!isPostgresReady(project, state))
      throw new LoadTestError("The run-owned PostgreSQL service is not accepting connections.");
    if (["returning-personal", "account-mutations", "browser-smoke", "capacity"].includes(configured.scenario)) {
      failurePhase = "passwordless_session_pool_preparation";
      const poolSize = configured.scenario === "browser-smoke" ? 1 : configured.maxVus;
      verifyDisposableDatabaseOperation(project, state, "test:loadtest-session-pool");
      const sessionPool = await prepareBrowserSessionPool(project, target, poolSize, cancellation.signal);
      sessionPoolJson = JSON.stringify(sessionPool);
    }
    if (configured.scenario === "shared-vault") {
      failurePhase = "shared_vault_fixture_preparation";
      verifyDisposableDatabaseOperation(project, state, "test:loadtest-shared-vault-fixtures");
      const fixtures = await prepareBrowserSharedFixtures(project, target, cancellation.signal);
      sharedFixturesJson = JSON.stringify(fixtures);
    }
    if (configured.scenario === "shared-account-mutations") {
      failurePhase = "shared_mutation_fixture_preparation";
      verifyDisposableDatabaseOperation(project, state, "test:loadtest-shared-mutation-fixtures");
      const fixtures = await prepareBrowserSharedMutationFixtures(project, target, cancellation.signal);
      sharedFixturesJson = JSON.stringify(fixtures);
    }
    failurePhase = "k6_scenario";
    verifyDisposableDatabaseOperation(project, state, "test:loadtest-scenario");
    runRecord.scenarioStartedAt = new Date().toISOString();
    captureResourceSnapshots(runRecord, project, state);
    resourceTimer = setInterval(() => captureResourceSnapshots(runRecord, project, state), 15_000);
    exitCode = await runK6(
      configured,
      options,
      project,
      summaryPath,
      sessionPoolJson,
      sharedFixturesJson,
      runRecord,
      tunnel,
      cancellation.signal,
      state,
    );
    if (configured.scenario === "first-time") {
      runRecord.failurePhaseDetail = firstTimeAssertionFailureDetail(readSanitizedSummary(summaryPath));
      if (runRecord.failurePhaseDetail) exitCode = 1;
    }
    if (configured.scenario === "rate-limits") {
      runRecord.failurePhaseDetail = rateLimitAssertionFailureDetail(
        readSanitizedSummary(summaryPath),
        options.boundary,
      );
      if (runRecord.failurePhaseDetail) exitCode = 1;
    }
    sessionPoolJson = "";
    sharedFixturesJson = "";
    runRecord.k6ExitCode = exitCode;
    runRecord.stopReason = exitCode === 0 ? "completed" : "k6_failed";
    runRecord.failurePhase = exitCode === 0 ? null : failurePhase;
  } catch (error) {
    sessionPoolJson = "";
    sharedFixturesJson = "";
    runRecord.failurePhase = failurePhase;
    runRecord.failurePhaseDetail = error instanceof LoadTestError ? error.failurePhaseDetail : null;
    runRecord.stopReason = cancellation.signal.aborted
      ? "cancelled"
      : error instanceof LoadTestError
        ? "preflight_or_health_failure"
        : "runner_failure";
    runRecord.k6ExitCode = exitCode;
  } finally {
    if (resourceTimer) clearInterval(resourceTimer);
    try {
      captureResourceSnapshots(runRecord, project, state);
      runRecord.endedAt = new Date().toISOString();
      runRecord.applicationRateLimits = aggregateRateLimitMetrics(project, state);
      runRecord.summary = readSanitizedSummary(summaryPath);
      writeFileSync(reportPath, `${JSON.stringify(runRecord, null, 2)}\n`, { flag: "wx", mode: 0o600 });
      chmodSync(reportPath, 0o600);
    } finally {
      try {
        if (exitCode === 0 ? !options["keep-stack"] : !shouldPreserveFailedRun(options)) await teardown(project, state);
      } finally {
        stopRunnerTunnel(tunnel);
        cancellation.dispose();
      }
    }
  }
  console.log(`report=${path.relative(ROOT, reportPath)}`);
  console.log(`scenario=${configured.scenario}`);
  console.log(`result=${exitCode === 0 ? "passed" : "failed"}`);
  if (exitCode !== 0) throw new LoadTestError("Load scenario failed; only the sanitized report was retained.");
}

function prepareBrowserSessionPool(project, target, count, signal) {
  const environment = browserHelperEnvironment(project, target);
  environment.LOADTEST_POOL_COUNT = String(count);
  return runBrowserJsonHelper(
    path.join(ROOT, "apps/web/scripts/load-test-prepare-pool.mjs"),
    environment,
    count * 45_000 + 60_000,
    (pool) => validateBrowserSessionPool(pool, count),
    "The real passwordless browser session pool failed its bounded structure checks.",
    signal,
  );
}

function prepareBrowserSharedFixtures(project, target, signal) {
  return runBrowserJsonHelper(
    path.join(ROOT, "apps/web/scripts/load-test-prepare-shared.mjs"),
    browserHelperEnvironment(project, target, "shared-vault"),
    15 * 60_000,
    validateBrowserSharedFixtures,
    "The real Shared Vault browser fixtures failed their bounded structure checks.",
    signal,
  );
}

function prepareBrowserSharedMutationFixtures(project, target, signal) {
  return runBrowserJsonHelper(
    path.join(ROOT, "apps/web/scripts/load-test-prepare-shared.mjs"),
    browserHelperEnvironment(project, target, "shared-account-mutations"),
    15 * 60_000,
    validateBrowserSharedMutationFixtures,
    "Distinct Shared Vault mutation fixtures failed their bounded structure checks.",
    signal,
  );
}

function browserHelperEnvironment(project, target, scenario) {
  const environment = cleanHostEnvironment();
  environment.LOADTEST_TARGET = target;
  environment.LOADTEST_MAILPIT_ORIGIN = MAILPIT_ORIGIN;
  environment.LOADTEST_PROJECT_ID = project;
  if (scenario) environment.LOADTEST_SCENARIO = scenario;
  return environment;
}

function runBrowserJsonHelper(helperPath, environment, timeoutMs, validate, failureMessage, signal) {
  if (signal.aborted)
    return Promise.reject(new LoadTestError("Browser preparation was cancelled.", "helper_cancelled"));
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [helperPath], {
      cwd: ROOT,
      env: environment,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const chunks = [];
    let byteLength = 0;
    let timedOut = false;
    let overflowed = false;
    let abortTimer;
    const terminate = () => {
      child.kill("SIGTERM");
      abortTimer = setTimeout(() => child.kill("SIGKILL"), 5_000);
    };
    const onAbort = () => terminate();
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) terminate();
    const timeout = setTimeout(() => {
      timedOut = true;
      terminate();
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      const buffer = Buffer.from(chunk);
      byteLength += buffer.byteLength;
      if (byteLength > 512_000) {
        overflowed = true;
        buffer.fill(0);
        child.kill("SIGTERM");
        return;
      }
      chunks.push(buffer);
    });
    child.once("error", () => {
      clearTimeout(timeout);
      clearTimeout(abortTimer);
      signal.removeEventListener("abort", onAbort);
      reject(new LoadTestError("The isolated browser preparation could not start.", "helper_process_start"));
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      clearTimeout(abortTimer);
      signal.removeEventListener("abort", onAbort);
      const output = Buffer.concat(chunks);
      try {
        if (timedOut) throw new LoadTestError(failureMessage, "helper_timeout");
        if (overflowed) throw new LoadTestError(failureMessage, "helper_output_limit");
        if (code !== 0) {
          const phase = parseBrowserHelperFailurePhase(output.toString("utf8"));
          throw new LoadTestError(failureMessage, phase ?? "helper_failed_unclassified");
        }
        let value;
        try {
          value = JSON.parse(output.toString("utf8"));
          validate(value);
        } catch {
          throw new LoadTestError(failureMessage, "helper_output_validation");
        }
        resolve(value);
      } catch (error) {
        reject(error instanceof LoadTestError ? error : new LoadTestError(failureMessage));
      } finally {
        output.fill(0);
        for (const chunk of chunks) chunk.fill(0);
        chunks.length = 0;
      }
    });
  });
}

function isValidSession(session) {
  const cookieNames = ["rhsia-passwordless-access=", "rhsia-passwordless-refresh=", "rhsia-passwordless-assertion="];
  return (
    !!session &&
    typeof session.cookie === "string" &&
    session.cookie.length <= 8_192 &&
    !/[\r\n]/.test(session.cookie) &&
    cookieNames.every((name) => session.cookie.includes(name)) &&
    typeof session.vaultId === "string" &&
    session.vaultId.length >= 1 &&
    session.vaultId.length <= 128
  );
}

export function validateBrowserSessionPool(pool, count) {
  if (
    !pool ||
    !Array.isArray(pool.sessions) ||
    pool.sessions.length !== count ||
    pool.sessions.some((session) => !isValidSession(session)) ||
    !hasDistinctSessions(pool.sessions) ||
    !pool.browserSession ||
    !isValidSession(pool.browserSession) ||
    pool.browserSession.cookie !== pool.sessions[0]?.cookie ||
    pool.browserSession.vaultId !== pool.sessions[0]?.vaultId ||
    typeof pool.browserSession.passphrase !== "string" ||
    pool.browserSession.passphrase.length < 16 ||
    pool.browserSession.passphrase.length > 256
  )
    throw new LoadTestError("The browser session pool structure is invalid.");
}

export function validateBrowserSharedFixtures(fixtures) {
  if (
    !fixtures ||
    typeof fixtures.sharedVaultId !== "string" ||
    fixtures.sharedVaultId.length < 1 ||
    fixtures.sharedVaultId.length > 128 ||
    !isValidSession(fixtures.owner) ||
    !Array.isArray(fixtures.members) ||
    fixtures.members.length !== 10 ||
    fixtures.members.some((member) => !isValidSession(member)) ||
    !hasDistinctSessions([fixtures.owner, ...fixtures.members])
  )
    throw new LoadTestError("The Shared Vault fixture structure is invalid.");
}

export function validateBrowserSharedMutationFixtures(fixtures) {
  if (
    !fixtures ||
    !Array.isArray(fixtures.subjects) ||
    fixtures.subjects.length !== 10 ||
    fixtures.subjects.some(
      (subject) =>
        !isValidSession(subject) ||
        typeof subject.sharedVaultId !== "string" ||
        subject.sharedVaultId.length < 1 ||
        subject.sharedVaultId.length > 128,
    ) ||
    !hasDistinctSessions(fixtures.subjects) ||
    new Set(fixtures.subjects.map((subject) => subject.sharedVaultId)).size !== fixtures.subjects.length
  )
    throw new LoadTestError("Distinct Shared Vault mutation fixtures are invalid.");
}

function hasDistinctSessions(sessions) {
  return (
    new Set(sessions.map((session) => session.cookie)).size === sessions.length &&
    new Set(sessions.map((session) => session.vaultId)).size === sessions.length
  );
}

function runK6(
  configured,
  options,
  project,
  summaryPath,
  sessionPoolJson,
  sharedFixturesJson,
  runRecord,
  tunnel,
  signal,
  state,
) {
  if (signal.aborted) return Promise.reject(new LoadTestError("The k6 scenario was cancelled."));
  const scriptPath = path.join(ROOT, "performance", "k6", configured.script);
  const environment = safeK6Environment(
    options,
    project,
    summaryPath,
    configured.scenario,
    configured.maxVus,
    configured.duration,
    sessionPoolJson,
    sharedFixturesJson,
  );
  return new Promise((resolve, reject) => {
    const child = spawn("k6", ["run", "--include-system-env-vars", scriptPath], {
      cwd: ROOT,
      env: environment,
      stdio: "ignore",
    });
    let healthTimer;
    let processTimer;
    let forceTimer;
    let stopError;
    let settled = false;
    const terminate = (error) => {
      if (settled || stopError) return;
      stopError = error;
      child.kill("SIGTERM");
      forceTimer = setTimeout(() => child.kill("SIGKILL"), 5_000);
    };
    const onAbort = () => terminate(new LoadTestError("The k6 scenario was cancelled."));
    signal.addEventListener("abort", onAbort, { once: true });
    const finish = (error, code) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      if (healthTimer) clearInterval(healthTimer);
      if (processTimer) clearInterval(processTimer);
      clearTimeout(forceTimer);
      captureK6ProcessSnapshot(runRecord, child.pid);
      captureSshTunnelProcessSnapshot(runRecord, tunnel?.child.pid);
      if (error) reject(error);
      else resolve(code ?? 1);
    };
    captureK6ProcessSnapshot(runRecord, child.pid);
    captureSshTunnelProcessSnapshot(runRecord, tunnel?.child.pid);
    processTimer = setInterval(() => {
      captureK6ProcessSnapshot(runRecord, child.pid);
      captureSshTunnelProcessSnapshot(runRecord, tunnel?.child.pid);
    }, 15_000);
    healthTimer = setInterval(async () => {
      if (settled || stopError) return;
      const healthy = await isHealthy(`${WEB_ORIGIN}/api/v1/health`, true);
      if (stopError) return;
      if (healthy && isPostgresReady(project, state)) return;
      terminate(new LoadTestError("The run-owned web or PostgreSQL health check failed during the load scenario."));
    }, 10_000);
    if (signal.aborted) onAbort();
    child.once("error", () => finish(new LoadTestError("The pinned k6 process could not be started.")));
    child.once("close", (code) => finish(stopError, code));
  });
}

function captureK6ProcessSnapshot(record, processId) {
  captureProcessSnapshot(record.k6ProcessSnapshots, processId);
}

function captureSshTunnelProcessSnapshot(record, processId) {
  captureProcessSnapshot(record.sshTunnelProcessSnapshots, processId);
}

function captureProcessSnapshot(snapshots, processId) {
  if (!Number.isSafeInteger(processId) || processId < 1 || snapshots.length >= 1_000) return;
  try {
    const result = spawnSync("ps", ["-o", "%cpu=,rss=", "-p", String(processId)], {
      encoding: "utf8",
      env: cleanHostEnvironment(),
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (result.status !== 0) return;
    const usage = parseProcessUsage(result.stdout ?? "");
    if (!usage) return;
    snapshots.push({ capturedAt: new Date().toISOString(), ...usage });
  } catch {
    return;
  }
}

export function parseBrowserHelperFailurePhase(output) {
  if (typeof output !== "string" || output.length > 256) return null;
  try {
    const parsed = JSON.parse(output);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      Object.keys(parsed).length !== 1 ||
      !BROWSER_HELPER_FAILURE_PHASES.has(parsed.failurePhase)
    )
      return null;
    return parsed.failurePhase;
  } catch {
    return null;
  }
}

export function firstTimeAssertionFailureDetail(summary) {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) return "first_time_summary_missing";
  const metrics = summary.metrics;
  if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) return "first_time_summary_missing";
  const milestones = [
    ["first_time_browser_page_created", "first_time_browser_not_started"],
    ["first_time_sign_in_page_loaded", "first_time_sign_in_page_not_loaded"],
    ["first_time_invalid_email_filled", "first_time_sign_in_form_input_failed"],
    ["first_time_invalid_email_blurred", "first_time_sign_in_form_blur_failed"],
    ["first_time_sign_in_form_hydrated", "first_time_sign_in_form_not_hydrated"],
    ["first_time_email_address_typed", "first_time_email_typing_failed"],
    ["first_time_email_address_filled", "first_time_email_input_failed"],
    ["first_time_email_address_retained", "first_time_email_not_retained"],
    ["first_time_email_address_focused", "first_time_email_focus_failed"],
    ["first_time_turnstile_ready", "first_time_turnstile_not_ready"],
    ["first_time_email_focus_moved", "first_time_email_focus_move_failed"],
    ["first_time_email_address_blurred", "first_time_email_blur_failed"],
    ["first_time_email_validation_cleared", "first_time_email_validation_not_observed"],
    ["first_time_email_validated", "first_time_email_not_validated"],
    ["first_time_passwordless_request_submitted", "first_time_passwordless_request_not_submitted"],
    ["first_time_passwordless_request_confirmed", "first_time_passwordless_request_not_confirmed"],
    ["first_time_magic_link_list_response_received", "first_time_magic_link_mailpit_list_unavailable"],
    ["first_time_magic_link_list_parsed", "first_time_magic_link_mailpit_list_invalid"],
    ["first_time_magic_link_message_found", "first_time_magic_link_message_not_found"],
    ["first_time_magic_link_message_id_validated", "first_time_magic_link_message_id_invalid"],
    ["first_time_magic_link_detail_received", "first_time_magic_link_detail_unavailable"],
    ["first_time_magic_link_detail_parsed", "first_time_magic_link_detail_invalid"],
    ["first_time_magic_link_confirmation_link_found", "first_time_magic_link_link_missing"],
    ["first_time_magic_link_url_parsed", "first_time_magic_link_url_parse_failed"],
    ["first_time_magic_link_origin_validated", "first_time_magic_link_origin_mismatch"],
    ["first_time_magic_link_path_validated", "first_time_magic_link_path_mismatch"],
    ["first_time_magic_link_token_present", "first_time_magic_link_token_missing"],
    ["first_time_magic_link_action_url_validated", "first_time_magic_link_url_validation_incomplete"],
    ["first_time_magic_link_mailbox_cleared", "first_time_magic_link_mailbox_cleanup_failed"],
    ["first_time_magic_link_captured", "first_time_magic_link_not_captured"],
    ["first_time_magic_link_redeemed", "first_time_magic_link_not_redeemed"],
    ["first_time_vault_name_filled", "first_time_vault_name_not_filled"],
    ["first_time_custom_passphrase_selected", "first_time_custom_passphrase_not_selected"],
    ["first_time_custom_passphrase_filled", "first_time_custom_passphrase_not_filled"],
    ["first_time_passphrase_confirmation_filled", "first_time_passphrase_confirmation_not_filled"],
    ["first_time_setup_acknowledgement_checked", "first_time_setup_acknowledgement_not_checked"],
    ["first_time_vault_setup_submit_enabled", "first_time_vault_setup_submit_not_enabled"],
    ["first_time_vault_setup_submit_clicked", "first_time_vault_setup_not_submitted"],
    ["first_time_vault_initialized", "first_time_vault_not_initialized"],
    ["first_time_vault_unlocked", "first_time_vault_not_unlocked"],
    ["first_time_account_creation_link_visible", "first_time_account_creation_link_not_visible"],
    ["first_time_account_creation_opened", "first_time_account_creation_not_opened"],
    ["first_time_manual_uri_section_opened", "first_time_manual_uri_section_not_opened"],
    ["first_time_manual_uri_filled", "first_time_manual_uri_not_filled"],
    ["first_time_manual_uri_submit_enabled", "first_time_manual_uri_submit_not_enabled"],
    ["first_time_manual_uri_submit_clicked", "first_time_manual_uri_submit_not_clicked"],
    ["first_time_account_review_form_visible", "first_time_account_review_form_not_visible"],
    ["first_time_account_save_enabled", "first_time_account_save_not_enabled"],
    ["first_time_account_save_submitted", "first_time_account_not_created"],
  ];
  for (const [metric, failureDetail] of milestones) {
    if (metrics[metric]?.count === 1) continue;
    if (metric === "first_time_vault_setup_submit_enabled") {
      if (metrics.first_time_vault_setup_submit_probe_started?.count !== 1)
        return "first_time_vault_setup_submit_probe_not_started";
      if (metrics.first_time_vault_setup_submit_button_located?.count !== 1)
        return "first_time_vault_setup_submit_button_missing";
      if (metrics.first_time_vault_setup_submit_disabled?.count !== 1)
        return "first_time_vault_setup_submit_probe_incomplete";
      if (metrics.first_time_vault_setup_validation_failed?.count === 1) {
        const invalidFields = [
          [
            "first_time_vault_setup_validation_vault_name_invalid",
            "first_time_vault_setup_validation_vault_name_invalid",
          ],
          [
            "first_time_vault_setup_validation_passphrase_invalid",
            "first_time_vault_setup_validation_passphrase_invalid",
          ],
          [
            "first_time_vault_setup_validation_confirmation_invalid",
            "first_time_vault_setup_validation_confirmation_invalid",
          ],
          [
            "first_time_vault_setup_validation_acknowledgement_invalid",
            "first_time_vault_setup_validation_acknowledgement_invalid",
          ],
        ];
        for (const [failureMetric, failureDetail] of invalidFields) {
          if (metrics[failureMetric]?.count === 1) return failureDetail;
        }
      }
      if (metrics.first_time_vault_setup_submit_busy?.count === 1) return "first_time_vault_setup_submit_busy";
      if (metrics.first_time_vault_setup_custom_mode_at_submit?.count !== 1)
        return "first_time_vault_setup_custom_mode_not_selected";
      return "first_time_vault_setup_submit_disabled_unclassified";
    }
    if (
      metric === "first_time_vault_initialized" &&
      metrics.first_time_custom_passphrase_form_state_invalid?.count === 1
    )
      return "first_time_custom_passphrase_form_state_invalid";
    if (
      metric === "first_time_vault_initialized" &&
      metrics.first_time_custom_passphrase_form_state_probe_incomplete?.count === 1
    )
      return "first_time_custom_passphrase_form_state_probe_incomplete";
    if (metric === "first_time_vault_initialized" && metrics.first_time_vault_setup_submit_busy_at_timeout?.count === 1)
      return "first_time_vault_initialization_still_pending";
    if (
      metric === "first_time_vault_initialized" &&
      metrics.first_time_vault_setup_diagnostic_probe_incomplete?.count === 1
    )
      return "first_time_vault_setup_diagnostic_probe_incomplete";
    if (
      metric === "first_time_vault_initialized" &&
      (metrics.first_time_vault_setup_validation_failed?.count === 1 ||
        metrics.first_time_vault_setup_failure_surface_unclassified?.count === 1)
    ) {
      const validationFailures = [
        [
          "first_time_vault_setup_validation_vault_name_invalid",
          "first_time_vault_setup_validation_vault_name_invalid",
        ],
        [
          "first_time_vault_setup_validation_passphrase_invalid",
          "first_time_vault_setup_validation_passphrase_invalid",
        ],
        [
          "first_time_vault_setup_validation_confirmation_invalid",
          "first_time_vault_setup_validation_confirmation_invalid",
        ],
        [
          "first_time_vault_setup_validation_acknowledgement_invalid",
          "first_time_vault_setup_validation_acknowledgement_invalid",
        ],
      ];
      for (const [failureMetric, failureDetail] of validationFailures) {
        if (metrics[failureMetric]?.count === 1) return failureDetail;
      }
      return "first_time_vault_initialization_failure_unclassified";
    }
    if (
      metric === "first_time_vault_initialized" &&
      metrics.first_time_vault_initialization_error_visible?.count === 1
    ) {
      const initializationFailures = [
        [
          "first_time_vault_initialization_client_crypto_failure",
          "first_time_vault_initialization_client_crypto_failure",
        ],
        ["first_time_vault_initialization_invalid_request", "first_time_vault_initialization_invalid_request"],
        ["first_time_vault_initialization_unauthenticated", "first_time_vault_initialization_unauthenticated"],
        ["first_time_vault_initialization_forbidden", "first_time_vault_initialization_forbidden"],
        ["first_time_vault_initialization_conflict", "first_time_vault_initialization_conflict"],
        ["first_time_vault_initialization_rate_limited", "first_time_vault_initialization_rate_limited"],
        ["first_time_vault_initialization_server_error", "first_time_vault_initialization_server_error"],
        ["first_time_vault_initialization_unexpected_response", "first_time_vault_initialization_unexpected_response"],
        ["first_time_vault_initialization_transport_error", "first_time_vault_initialization_transport_error"],
        ["first_time_vault_initialization_request_failure", "first_time_vault_initialization_request_failure"],
        ["first_time_vault_initialization_post_failure", "first_time_vault_initialization_post_failure"],
        [
          "first_time_vault_initialization_failure_unclassified",
          "first_time_vault_initialization_failure_unclassified",
        ],
      ];
      for (const [failureMetric, failureDetail] of initializationFailures) {
        if (metrics[failureMetric]?.count === 1) return failureDetail;
      }
      return "first_time_vault_initialization_rejected";
    }
    return failureDetail;
  }
  if (metrics.first_time_otp_rendered?.count !== 1) return "first_time_otp_not_rendered";
  if (metrics.first_time_assertion_block_started?.count !== 1) return "first_time_assertion_block_not_reached";
  if (metrics.first_time_assertion_block_completed?.count !== 1) return "first_time_assertion_block_incomplete";
  const checks = metrics.checks;
  if (
    !checks ||
    typeof checks !== "object" ||
    typeof checks.rate !== "number" ||
    typeof checks.passes !== "number" ||
    typeof checks.fails !== "number" ||
    checks.passes + checks.fails !== 2
  )
    return "first_time_check_observations_missing";
  if (checks.rate !== 1 || checks.fails !== 0) return "first_time_assertions_failed";
  return null;
}

export function rateLimitAssertionFailureDetail(summary, boundary) {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) return "rate_limit_summary_missing";
  const metrics = summary.metrics;
  if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) return "rate_limit_summary_missing";
  const expectations =
    boundary === "email"
      ? [{ prefix: "rate_limit_anonymous_boundary", attempts: 6, admitted: 5, limited: 1 }]
      : boundary === "network"
        ? [{ prefix: "rate_limit_anonymous_boundary", attempts: 21, admitted: 20, limited: 1 }]
        : boundary === "authenticated"
          ? [
              { prefix: "rate_limit_key_material_mutation", attempts: 11, admitted: 10, limited: 1 },
              { prefix: "rate_limit_account_mutation", attempts: 121, admitted: 120, limited: 1 },
              { prefix: "rate_limit_vault_mutation", attempts: 31, admitted: 30, limited: 1 },
              { prefix: "rate_limit_membership_mutation", attempts: 31, admitted: 30, limited: 1 },
            ]
          : null;
  if (!expectations) return "rate_limit_boundary_unsupported";
  for (const expectation of expectations) {
    const observed = {
      attempts: metrics[`${expectation.prefix}_attempts`]?.count,
      admitted: metrics[`${expectation.prefix}_admitted`]?.count,
      limited: metrics[`${expectation.prefix}_limited`]?.count,
    };
    if (Object.values(observed).some((value) => !Number.isSafeInteger(value) || value < 0))
      return "rate_limit_boundary_observations_missing";
    if (observed.attempts !== expectation.attempts) return "rate_limit_boundary_attempt_count_mismatch";
    if (observed.admitted !== expectation.admitted) return "rate_limit_boundary_admitted_count_mismatch";
    if (observed.limited !== expectation.limited) return "rate_limit_boundary_limited_count_mismatch";
  }
  return null;
}

export function parseProcessUsage(output) {
  if (typeof output !== "string") return null;
  const fields = output.trim().split(/\s+/);
  if (fields.length !== 2) return null;
  const cpuPercent = Number(fields[0]);
  const residentMemoryKiB = Number(fields[1]);
  if (
    !Number.isFinite(cpuPercent) ||
    cpuPercent < 0 ||
    cpuPercent > 10_000 ||
    !Number.isSafeInteger(residentMemoryKiB) ||
    residentMemoryKiB < 0 ||
    residentMemoryKiB > Math.floor(Number.MAX_SAFE_INTEGER / 1_024)
  )
    return null;
  return { cpuPercent, residentMemoryBytes: residentMemoryKiB * 1_024 };
}

function readSanitizedSummary(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    const summary = JSON.parse(readFileSync(filePath, "utf8"));
    if (!summary || typeof summary !== "object" || Array.isArray(summary)) return null;
    return summary;
  } catch {
    return null;
  }
}

function machineSummary() {
  return {
    platform: os.platform(),
    release: os.release(),
    architecture: os.arch(),
    logicalCpuCount: os.cpus().length,
    memoryBytes: os.totalmem(),
  };
}

function stackHostSummary(project, state) {
  try {
    const result = spawnSync("docker", ["info", "--format", "{{.OSType}}|{{.Architecture}}|{{.NCPU}}|{{.MemTotal}}"], {
      encoding: "utf8",
      env: safeComposeEnvironment(project, state),
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (result.status !== 0) return null;
    const [platform, architecture, cpuCount, memoryBytes] = (result.stdout ?? "").trim().split("|");
    const cpus = Number(cpuCount);
    const memory = Number(memoryBytes);
    if (
      !/^[a-z0-9._-]{1,32}$/.test(platform ?? "") ||
      !/^[A-Za-z0-9._-]{1,32}$/.test(architecture ?? "") ||
      !Number.isSafeInteger(cpus) ||
      cpus < 1 ||
      cpus > 1024 ||
      !Number.isSafeInteger(memory) ||
      memory < 1
    )
      return null;
    return { platform, architecture, logicalCpuCount: cpus, memoryBytes: memory };
  } catch {
    return null;
  }
}

function captureResourceSnapshots(record, project, state) {
  const capturedAt = new Date().toISOString();
  if (record.dockerSnapshots.length < 1_000)
    record.dockerSnapshots.push({ capturedAt, containers: dockerStats(project, state) });
  if (record.postgresSnapshots.length < 1_000)
    record.postgresSnapshots.push({ capturedAt, activity: postgresSnapshot(project, state) });
}

export function scenarioProfile(configured, options = {}) {
  if (configured.scenario === "capacity")
    return { maxVus: configured.maxVus, duration: configured.duration, browserVus: 0 };
  if (configured.scenario === "returning-personal") return { ...defaultProfile(), browserVus: 1 };
  if (configured.scenario === "shared-vault") return { ...defaultProfile(), browserPreparationMembers: 10 };
  if (configured.scenario === "account-mutations")
    return {
      iterationsPerSecond: 1,
      duration: "2m",
      maxVus: 10,
      distinctUsers: 10,
      mutationRequestsPerIteration: 2,
    };
  if (configured.scenario === "shared-account-mutations")
    return { iterationsPerSecond: 1, duration: "2m", maxVus: 1, distinctUsersAndSharedVaults: 10 };
  if (configured.scenario === "rate-limits") {
    const expectedLimit = options.boundary === "email" ? 5 : options.boundary === "network" ? 20 : null;
    return {
      boundary: options.boundary,
      expectedLimit,
      authenticatedPolicies: options.boundary === "authenticated" ? [10, 120, 30, 30] : [],
    };
  }
  return { vus: 1, iterations: 1 };
}

export function defaultProfile() {
  return {
    rampBetweenStages: "10s",
    stages: [
      { targetVus: 1, hold: "2m" },
      { targetVus: 5, hold: "2m" },
      { targetVus: 10, hold: "2m" },
    ],
  };
}

function dockerStats(project, state) {
  try {
    const ids = runCompose(project, state, ["ps", "-q"], { capture: true }).split(/\r?\n/).filter(Boolean);
    if (ids.length === 0) return [];
    const result = spawnSync(
      "docker",
      ["stats", "--no-stream", "--format", "{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}", ...ids],
      {
        encoding: "utf8",
        env: safeComposeEnvironment(project, state),
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    if (result.status !== 0) return [];
    return (result.stdout ?? "")
      .trim()
      .split(/\r?\n/)
      .map((line) => {
        const [name, cpuPercent, memoryUsage, memoryPercent] = line.split("|");
        if (!name?.startsWith(`${project}-`) || !/^\d+(?:\.\d+)?%$/.test(cpuPercent ?? "")) return null;
        const service = name.slice(project.length + 1).replace(/-\d+$/, "");
        if (!/^[a-z-]+$/.test(service) || !/^\d+(?:\.\d+)?%$/.test(memoryPercent ?? "")) return null;
        if (!/^\d+(?:\.\d+)?\s*[A-Za-z]+\s*\/\s*\d+(?:\.\d+)?\s*[A-Za-z]+$/.test(memoryUsage ?? "")) return null;
        return { service, cpuPercent, memoryUsage, memoryPercent };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function postgresSnapshot(project, state) {
  try {
    const query =
      "SELECT coalesce(state, 'unknown') || ':' || count(*) FROM pg_stat_activity WHERE datname = current_database() GROUP BY state ORDER BY state";
    const output = runCompose(
      project,
      state,
      [
        "exec",
        "--no-TTY",
        "db",
        "psql",
        "--no-psqlrc",
        "--tuples-only",
        "--no-align",
        "-U",
        "loadtest",
        "-d",
        DATABASE_NAME,
        "-c",
        query,
      ],
      { capture: true },
    );
    return output.split(/\r?\n/).filter((line) => /^(?:active|idle|idle in transaction|unknown):\d+$/.test(line));
  } catch {
    return [];
  }
}

function aggregateRateLimitMetrics(project, state) {
  try {
    const logs = runCompose(project, state, ["logs", "--no-color", "--since", "15m", "api"], { capture: true });
    const totals = {};
    for (const line of logs.split(/\r?\n/)) {
      const start = line.indexOf("{");
      if (start < 0 || !line.includes('"event":"application_rate_limit_metrics"')) continue;
      try {
        const event = JSON.parse(line.slice(start));
        if (event.event !== "application_rate_limit_metrics" || !event.counts || typeof event.counts !== "object")
          continue;
        for (const [key, count] of Object.entries(event.counts)) {
          if (!/^[a-z_]+:(?:allowed|limited|unavailable)$/.test(key) || !Number.isSafeInteger(count) || count < 0)
            continue;
          totals[key] = Math.min((totals[key] ?? 0) + count, 2_147_483_647);
        }
      } catch {
        continue;
      }
    }
    return totals;
  } catch {
    return {};
  }
}

function discardUnstartedProject(project, state) {
  verifyDisposableDatabaseOperation(project, state, "test:loadtest-stack-create");
  rmSync(projectDirectory(project), { recursive: true, force: true });
}

async function teardown(project, state, { preserve = false } = {}) {
  if (preserve) return;
  assertDockerContextMatches(state);
  try {
    verifyDisposableDatabaseOperation(project, state, "test:loadtest-teardown");
  } catch (error) {
    try {
      discardUnstartedProject(project, state);
      return;
    } catch {
      throw error;
    }
  }
  runCompose(project, state, ["down", "--volumes", "--remove-orphans"]);
  rmSync(projectDirectory(project), { recursive: true, force: true });
}

async function stopProject(options) {
  const project = validateProject(requiredOption(options, "project"));
  const target = validateTarget(requiredOption(options, "target"));
  const state = readState(project);
  validateRunnerPlacementOption(options, state);
  if (target !== state.target) throw new LoadTestError("The target does not match this run's Compose project.");
  assertDockerContextMatches(state);
  await teardown(project, state);
  console.log(`teardown=complete`);
  console.log(`project=${project}`);
}

function printHelp() {
  console.log(`Self-hosted k6 load-test runner (web origin is fixed to ${WEB_ORIGIN}).

Commands:
  pnpm loadtest new --target ${WEB_ORIGIN}
  pnpm loadtest up --project <run-id> --target ${WEB_ORIGIN}
  pnpm loadtest migrate --project <run-id> --target ${WEB_ORIGIN} --confirm-migration <run-id>/${DATABASE_NAME} [--preserve-on-failure]
  pnpm loadtest run --project <run-id> --target ${WEB_ORIGIN} --scenario <name>
  pnpm loadtest down --project <run-id> --target ${WEB_ORIGIN}

Scenarios: returning-personal, account-mutations, browser-smoke, first-time, shared-vault, shared-account-mutations, rate-limits, capacity.
Rate-limit boundaries: add --boundary email|network|authenticated; every scenario requires a fresh disposable project and database.
Capacity: requires --max-vus <11-20>, --confirm-high-vus <exact-ceiling>, and --duration <integer>s|<integer>m (1s-10m). Run-owned disposable database operations require a local Docker context and use the recorded capped-local-v1 Compose resource profile. Same-machine capacity is a capped local characterization, not a separate-host or general capacity claim.
Remote SSH Docker contexts are not accepted for disposable database operations under the current repository scope policy.
Migration and scenario failures tear down only the exact run project by default. Use --preserve-on-failure to retain a failed migration/stack/scenario explicitly; use --keep-stack to retain a completed run.
`);
}

async function main() {
  const { command, options } = parseArguments(process.argv.slice(2));
  if (command === "help") return printHelp();
  if (command === "new") return createProject(options);
  if (command === "up") return bringUp(options);
  if (command === "migrate") return migrate(options);
  if (command === "run") return runScenario(options);
  if (command === "down") return stopProject(options);
  throw new LoadTestError("Unknown load-test command.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    if (error instanceof LoadTestError) {
      console.error(`loadtest: ${error.message}`);
      process.exitCode = 1;
      return;
    }
    console.error("loadtest: unexpected failure; details suppressed to protect run credentials and tokens.");
    process.exitCode = 1;
  });
}
