import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import {
  classifyMagicLinkRequestFailure,
  classifySharedVaultCreationStatus,
  classifySharedVaultInvitationStatus,
  classifySharedInvitationClickError,
  classifySharedInvitationSubmitFailure,
  classifySharedInvitationEventOutcome,
  shouldRequestSharedInvitationSubmit,
  classifySharedVaultUnlockOutcome,
  shouldRetrySharedInvitationSubmitWithKeyboard,
  classifyWorkspaceUnlockFailureCode,
  isMagicLinkRequestTarget,
  isSameOriginAuthPostTarget,
  isSharedVaultCreationRequestTarget,
  isSharedVaultInvitationCreationRequestTarget,
  isSharedVaultManagementDetailsPath,
} from "../apps/web/scripts/load-test-browser-support.mjs";
import {
  applyLoadTestResourceProfile,
  defaultProfile,
  firstTimeAssertionFailureDetail,
  rateLimitAssertionFailureDetail,
  LOADTEST_RESOURCE_PROFILE,
  LOADTEST_SERVICE_RESOURCE_LIMITS,
  mailpitMessageListIsEmpty,
  mailpitPreflightMessageCaptured,
  parseBrowserHelperFailurePhase,
  parseMigrationDockerStats,
  parseProcessUsage,
  scenarioProfile,
  shouldPreserveFailedRun,
  validateBrowserSessionPool,
  validateBrowserSharedFixtures,
  validateBrowserSharedMutationFixtures,
  validateFreshScenarioState,
  validateHighCeiling,
  validateMigrationConfirmation,
  validateProject,
  validateRunnerPlacement,
  validateScenario,
  validateTarget,
} from "./load-test.mjs";

test("load-test targets are explicitly pinned to the requested localhost web port", () => {
  assert.equal(validateTarget("http://localhost:4000"), "http://localhost:4000");
  for (const target of [
    undefined,
    "",
    "https://localhost:4000",
    "http://localhost:3000",
    "http://127.0.0.1:4000",
    "http://example.com:4000",
    "http://localhost:4000/v1",
    "http://user:password@localhost:4000",
    "http://localhost:4000/?target=production",
  ])
    assert.throws(() => validateTarget(target));
});

test("load-test stack keeps the latest-main loopback binding and healthcheck", () => {
  const source = readFileSync(new URL("./load-test.mjs", import.meta.url), "utf8");
  const composeEnvironmentStart = source.indexOf("function safeComposeEnvironment");
  const composeEnvironmentEnd = source.indexOf("function safeK6Environment", composeEnvironmentStart);
  assert.ok(composeEnvironmentStart >= 0 && composeEnvironmentEnd > composeEnvironmentStart);
  const composeEnvironment = source.slice(composeEnvironmentStart, composeEnvironmentEnd);
  assert.ok(composeEnvironment.includes('environment.APP_BIND_ADDRESS = "127.0.0.1"'));
  assert.ok(composeEnvironment.includes('environment.APP_PORT = "4000"'));
  assert.ok(composeEnvironment.includes('environment.WEB_CONTAINER_PORT = "3000"'));
  assert.ok(source.includes('"APP_BIND_ADDRESS=127.0.0.1"'));
  assert.ok(source.includes('"APP_PORT=4000"'));
  assert.ok(source.includes('"WEB_CONTAINER_PORT=3000"'));

  const compose = readFileSync(new URL("../docker-compose.yml", import.meta.url), "utf8");
  assert.ok(compose.includes('"${APP_BIND_ADDRESS:-127.0.0.1}:${APP_PORT:-3000}:3000"'));
  assert.ok(compose.includes("fetch('http://127.0.0.1:3000/healthz')"));
});

test("Compose resource limits override modified private env-file values", () => {
  const source = readFileSync(new URL("./load-test.mjs", import.meta.url), "utf8");
  const composeStart = source.indexOf("function safeComposeEnvironment");
  const composeEnd = source.indexOf("function safeK6Environment", composeStart);
  assert.ok(composeStart >= 0 && composeEnd > composeStart);
  assert.ok(source.slice(composeStart, composeEnd).includes("applyLoadTestResourceProfile(environment)"));

  const environment = {
    LOADTEST_DB_CPUS: "99",
    LOADTEST_DB_MEMORY: "99g",
    LOADTEST_WEB_CPUS: "99",
    LOADTEST_WEB_MEMORY: "99g",
  };
  assert.equal(applyLoadTestResourceProfile(environment), environment);
  for (const [key, value] of Object.entries(LOADTEST_SERVICE_RESOURCE_LIMITS)) {
    const name = key.toUpperCase().replaceAll("-", "_");
    assert.equal(environment[`LOADTEST_${name}_CPUS`], value.cpus);
    assert.equal(environment[`LOADTEST_${name}_MEMORY`], value.memory);
  }
});

test("load-test project IDs must be generated run-owned Compose projects", () => {
  assert.equal(validateProject("rhasia-load-012345abcdef"), "rhasia-load-012345abcdef");
  assert.equal(validateProject("rhasia-load-0123456789abcdef"), "rhasia-load-0123456789abcdef");
  for (const project of [
    "rhasia-scret-selfhosted",
    "rhasia-load-0123456789",
    "rhasia-load-012345ABCDEf",
    "arbitrary-project",
    "",
  ])
    assert.throws(() => validateProject(project));
});

test("migration confirmation binds the action to one exact project and database", () => {
  const project = "rhasia-load-012345abcdef";
  assert.equal(
    validateMigrationConfirmation(project, "loadtest_vault", `${project}/loadtest_vault`),
    `${project}/loadtest_vault`,
  );
  assert.throws(() =>
    validateMigrationConfirmation(project, "loadtest_vault", "rhasia-load-ffffffffffff/loadtest_vault"),
  );
  assert.throws(() => validateMigrationConfirmation(project, "loadtest_vault", `${project}/other_database`));
});

test("load-test verifies the empty exact project before starting its PostgreSQL service", () => {
  const source = readFileSync(new URL("./load-test.mjs", import.meta.url), "utf8");
  const bringUpStart = source.indexOf("async function bringUp(options)");
  const bringUpEnd = source.indexOf("async function waitForBootstrapServices", bringUpStart);
  assert.ok(bringUpStart >= 0 && bringUpEnd > bringUpStart);
  const bringUpSource = source.slice(bringUpStart, bringUpEnd);
  const preflight = bringUpSource.indexOf(
    'verifyDisposableDatabaseOperation(project, state, "test:loadtest-stack-create")',
  );
  const startDatabase = bringUpSource.indexOf('runCompose(project, state, ["up", "--detach", "db"])');
  const inspectDatabase = bringUpSource.indexOf(
    'verifyDisposableDatabaseOperation(project, state, "test:loadtest-stack")',
  );
  assert.ok(preflight >= 0 && preflight < startDatabase && startDatabase < inspectDatabase);
});

test("teardown only removes retained private state after the empty-project scope check", () => {
  const source = readFileSync(new URL("./load-test.mjs", import.meta.url), "utf8");
  const discardStart = source.indexOf("function discardUnstartedProject");
  const teardownStart = source.indexOf("async function teardown", discardStart);
  const teardownEnd = source.indexOf("async function stopProject", teardownStart);
  assert.ok(discardStart >= 0 && teardownStart > discardStart && teardownEnd > teardownStart);
  const discard = source.slice(discardStart, teardownStart);
  const teardown = source.slice(teardownStart, teardownEnd);
  assert.ok(
    discard.indexOf('verifyDisposableDatabaseOperation(project, state, "test:loadtest-stack-create")') >= 0 &&
      discard.indexOf('verifyDisposableDatabaseOperation(project, state, "test:loadtest-stack-create")') <
        discard.indexOf("rmSync(projectDirectory(project)"),
  );
  assert.ok(teardown.indexOf('verifyDisposableDatabaseOperation(project, state, "test:loadtest-teardown")') >= 0);
  const emptyProjectFallback = teardown.indexOf("discardUnstartedProject(project, state)");
  const composeTeardown = teardown.indexOf('runCompose(project, state, ["down", "--volumes", "--remove-orphans"])');
  assert.ok(emptyProjectFallback > 0 && composeTeardown > emptyProjectFallback);
});

test("load-test builds app images before starting containers without an implicit pull", () => {
  const source = readFileSync(new URL("./load-test.mjs", import.meta.url), "utf8");
  const bringUpStart = source.indexOf("async function bringUp(options)");
  const bringUpEnd = source.indexOf("async function waitForBootstrapServices", bringUpStart);
  const bringUpSource = source.slice(bringUpStart, bringUpEnd);
  const build = bringUpSource.indexOf('runCompose(project, state, ["build", "api", "web", "retention-purge"])');
  const start = bringUpSource.indexOf(
    'runCompose(project, state, ["up", "--detach", "--no-build", "--pull", "never", "api", "web", "retention-purge"])',
  );
  assert.ok(build >= 0 && start > build);
});

test("separate-runner placement requires the dedicated SSH context and exact localhost tunnel confirmation", () => {
  assert.equal(validateRunnerPlacement("same-machine", { placement: "same-machine" }), "same-machine");
  const remote = { name: "rhasia-loadtest-generator", placement: "separate-runner" };
  assert.equal(
    validateRunnerPlacement("separate-runner", remote, "rhasia-loadtest-generator/http://localhost:4000/ssh-tunnel"),
    "separate-runner",
  );
  assert.throws(() => validateRunnerPlacement("separate-runner", remote, "localhost:4000"));
  assert.throws(() =>
    validateRunnerPlacement(
      "separate-runner",
      { name: "production", placement: "separate-runner" },
      "production/http://localhost:4000/ssh-tunnel",
    ),
  );
  assert.throws(() => validateRunnerPlacement("same-machine", { placement: "separate-runner" }));
});

test("failed disposable operations are preserved only by explicit opt-in", () => {
  assert.equal(shouldPreserveFailedRun({}), false);
  assert.equal(shouldPreserveFailedRun({ "preserve-on-failure": true }), true);
  assert.equal(shouldPreserveFailedRun({ "keep-stack": true }), true);
  assert.equal(shouldPreserveFailedRun({ "preserve-on-failure": false, "keep-stack": false }), false);
});

test("each rate-limit boundary project is consumed by one fresh scenario only", () => {
  assert.doesNotThrow(() => validateFreshScenarioState({}));
  assert.throws(() => validateFreshScenarioState({ loadScenarioStartedAt: "2026-01-01T00:00:00.000Z" }));
});

test("scenario selection keeps rate-limit groups separate and fresh", () => {
  assert.equal(
    validateScenario({ scenario: "rate-limits", boundary: "network" }, { runnerPlacement: "same-machine" }).script,
    "rate-limits.js",
  );
  assert.throws(() =>
    validateScenario({ scenario: "rate-limits", boundary: "all" }, { runnerPlacement: "same-machine" }),
  );
  assert.equal(
    validateScenario({ scenario: "shared-account-mutations" }, { runnerPlacement: "same-machine" }).script,
    "shared-account-mutations.js",
  );
  assert.throws(() =>
    validateScenario({ scenario: "shared-vault", boundary: "network" }, { runnerPlacement: "same-machine" }),
  );
  assert.throws(() =>
    validateScenario(
      { scenario: "capacity", "max-vus": "11", duration: "5m", "confirm-high-vus": "11" },
      { runnerPlacement: "same-machine" },
    ),
  );
  assert.equal(
    validateScenario(
      { scenario: "capacity", "max-vus": "11", duration: "5m", "confirm-high-vus": "11" },
      { runnerPlacement: "separate-runner" },
    ).maxVus,
    11,
  );
});

test("prepared personal and Shared Vault sessions require distinct synthetic users and resources", () => {
  const sessions = Array.from({ length: 10 }, (_, index) => ({
    cookie: `rhsia-passwordless-access=access-${index};rhsia-passwordless-refresh=refresh-${index};rhsia-passwordless-assertion=assertion-${index}`,
    vaultId: `personal-vault-${index}`,
  }));
  const pool = {
    sessions,
    browserSession: { ...sessions[0], passphrase: "synthetic example passphrase" },
  };
  assert.doesNotThrow(() => validateBrowserSessionPool(pool, 10));
  assert.throws(() =>
    validateBrowserSessionPool({ ...pool, sessions: [sessions[0], ...sessions.slice(1, 9), sessions[0]] }, 10),
  );

  const members = Array.from({ length: 10 }, (_, index) => ({
    cookie: `rhsia-passwordless-access=member-access-${index};rhsia-passwordless-refresh=member-refresh-${index};rhsia-passwordless-assertion=member-assertion-${index}`,
    vaultId: `member-vault-${index}`,
  }));
  const sharedFixtures = { sharedVaultId: "shared-vault-1", owner: sessions[0], members };
  assert.doesNotThrow(() => validateBrowserSharedFixtures(sharedFixtures));
  assert.throws(() =>
    validateBrowserSharedFixtures({ ...sharedFixtures, members: [sessions[0], ...members.slice(1)] }),
  );
});

test("Shared Vault mutation fixtures require unique users and unique vault resources", () => {
  const subjects = Array.from({ length: 10 }, (_, index) => ({
    cookie: `rhsia-passwordless-access=access-${index};rhsia-passwordless-refresh=refresh-${index};rhsia-passwordless-assertion=assertion-${index}`,
    vaultId: `personal-vault-${index}`,
    sharedVaultId: `shared-vault-${index}`,
  }));
  assert.doesNotThrow(() => validateBrowserSharedMutationFixtures({ subjects }));
  assert.throws(() =>
    validateBrowserSharedMutationFixtures({
      subjects: [...subjects.slice(0, 9), { ...subjects[9], sharedVaultId: subjects[0].sharedVaultId }],
    }),
  );
});

test("Shared invitation fragments stay in helper memory and out of fixtures and reports", () => {
  const preparation = readFileSync(
    new URL("../apps/web/scripts/load-test-prepare-shared.mjs", import.meta.url),
    "utf8",
  );
  const browserSupport = readFileSync(
    new URL("../apps/web/scripts/load-test-browser-support.mjs", import.meta.url),
    "utf8",
  );
  const runner = readFileSync(new URL("./load-test.mjs", import.meta.url), "utf8");
  const invitationFlow = browserSupport.slice(
    browserSupport.indexOf("export async function createSecureInvitation"),
    browserSupport.indexOf("export async function redeemSharedVaultInvitation"),
  );
  const runRecord = runner.match(/const runRecord = \{([\s\S]*?)\n  \};/)?.[1];
  assert(invitationFlow.length > 0);
  assert(invitationFlow.includes("return invitation;"));
  assert.equal(invitationFlow.includes("console."), false);
  assert.match(preparation, /invitation = "";/);
  assert.match(
    preparation,
    /output = \{\s*sharedVaultId,\s*owner:\s*\{\s*cookie: owner\.cookie,\s*vaultId: owner\.vaultId\s*\},\s*members,\s*\};/,
  );
  assert.match(preparation, /process\.stdout\.write\(JSON\.stringify\(\{\s*failurePhase\s*\}\)\)/);
  assert(runRecord);
  assert.equal(/cookie|invitation|sessionPoolJson|sharedFixturesJson/i.test(runRecord), false);
});

test("magic-link response diagnostics map to fixed codes without retaining response details", () => {
  assert.equal(classifyMagicLinkRequestFailure(400, { error: "invalid_request" }), "request_response_invalid_request");
  assert.equal(
    classifyMagicLinkRequestFailure(403, { error: "turnstile_failed" }),
    "request_response_turnstile_failed",
  );
  assert.equal(
    classifyMagicLinkRequestFailure(503, { error: "email_delivery_failed" }),
    "request_response_email_delivery_failed",
  );
  assert.equal(classifyMagicLinkRequestFailure(403, { error: "unknown" }), "request_response_forbidden");
  assert.equal(classifyMagicLinkRequestFailure(502, {}), "request_response_server_error");
  assert.equal(classifyMagicLinkRequestFailure(200, {}), null);
});

test("browser helper diagnostics accept only fixed failure-phase identifiers", () => {
  assert.equal(parseBrowserHelperFailurePhase('{"failurePhase":"turnstile_ready"}'), "turnstile_ready");
  assert.equal(parseBrowserHelperFailurePhase('{"failurePhase":"magic_link_email_wait"}'), "magic_link_email_wait");
  assert.equal(
    parseBrowserHelperFailurePhase('{"failurePhase":"request_response_email_delivery_failed"}'),
    "request_response_email_delivery_failed",
  );
  assert.equal(parseBrowserHelperFailurePhase('{"failurePhase":"request_not_dispatched"}'), "request_not_dispatched");
  for (const failurePhase of [
    "request_unexpected_endpoint",
    "request_client_alert",
    "request_offline_client_alert",
    "request_client_status",
    "email_form_hydration",
    "first_time_summary_missing",
    "first_time_otp_not_rendered",
    "first_time_assertion_block_not_reached",
    "first_time_assertion_block_incomplete",
    "first_time_check_observations_missing",
    "first_time_assertions_failed",
    "shared_web_health_check",
    "shared_member_session_preparation",
    "shared_invitation_redemption",
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
    "shared_fixture_output",
    "shared_creation_not_dispatched",
    "shared_creation_response_timeout",
    "shared_creation_validation_rejected",
    "shared_creation_unauthenticated",
    "shared_creation_forbidden",
    "shared_creation_conflict",
    "shared_creation_rate_limited",
    "shared_creation_server_error",
    "shared_creation_unexpected_status",
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
  ])
    assert.equal(parseBrowserHelperFailurePhase(JSON.stringify({ failurePhase })), failurePhase);
  assert.equal(parseBrowserHelperFailurePhase('{"failurePhase":"unknown"}'), null);
  assert.equal(parseBrowserHelperFailurePhase('{"failurePhase":"turnstile_ready","error":"private data"}'), null);
  assert.equal(parseBrowserHelperFailurePhase("browser error with stack trace"), null);
});

test("pinned k6 browser scripts avoid unsupported Playwright locator APIs", () => {
  const directory = new URL("../performance/k6/", import.meta.url);
  for (const filename of readdirSync(directory).filter((entry) => entry.endsWith(".js"))) {
    const source = readFileSync(new URL(filename, directory), "utf8");
    assert.equal(
      /\.getBy[A-Z]\w*\s*\(|\.evaluate\s*\(|\.waitFor(?:Request|Response|Event)\s*\(|\.(?:first|last|count)\s*\(|\.on\s*\(\s*["'](?:request|response)["']/.test(
        source,
      ),
      false,
      `${filename} uses a locator API unavailable in k6 v0.57.0`,
    );
  }
});

test("k6 first-time sign-in uses a supported focus target to trigger valid email blur", () => {
  const source = readFileSync(new URL("../performance/k6/browser-flows.js", import.meta.url), "utf8");
  assert.equal(source.split('page.keyboard.press("Tab")').length - 1, 1);
  assert(source.includes('await emailField.fill("")'));
  assert(source.includes("await emailField.type(email)"));
  assert(source.includes("await emailField.focus()"));
  assert(source.includes("const submit = page.locator('form:has(#email) button[type=\"submit\"]')"));
  assert(source.includes("await waitForEnabled(submit)"));
  assert(source.includes("await submit.focus()"));
  assert(source.includes('emailField.getAttribute("aria-invalid")) === "false"'));
  assert.equal(source.includes(".evaluate("), false);
  assert.equal(source.includes("focusTarget"), false);
  assert.equal(source.includes("emailField.blur()"), false);
  assert.equal(source.includes("element.blur()"), false);
  assert.equal(source.includes("page.waitForFunction"), false);
  assert(source.indexOf("await waitForEnabled(submit)") < source.indexOf("await submit.focus()"));
  assert(
    source.indexOf("await submit.focus()") < source.indexOf('emailField.getAttribute("aria-invalid")) === "false"'),
  );
});

test("anonymous rate-limit probes use fresh widget tokens without retaining response secrets", () => {
  const source = readFileSync(new URL("../performance/k6/rate-limits.js", import.meta.url), "utf8");
  assert(source.includes("page.locator('input[name=\"cf-turnstile-response\"]')"));
  assert(source.includes("turnstileToken = await tokenInput.inputValue()"));
  assert(source.includes('JSON.stringify({ email, client: "web", returnPath: "/vaults", turnstileToken })'));
  assert(source.includes("http.post(`${BASE_URL}/api/v1/auth/magic-link/request`, requestBody"));
  assert(source.includes("origin: BASE_URL"));
  assert(source.includes('response.headers["Retry-After"]'));
  assert(source.includes('"limited passwordless request returns rate_limited"'));
  assert(source.includes('"admitted passwordless request confirms delivery"'));
  assert(source.includes('requestBody = "";'));
  assert(source.includes('turnstileToken = "";'));
  const anonymousBoundaryStart = source.indexOf("async function runAnonymousBoundary");
  const anonymousBoundaryEnd = source.indexOf("async function verifyPasswordlessRequest", anonymousBoundaryStart);
  const anonymousBoundary = source.slice(anonymousBoundaryStart, anonymousBoundaryEnd);
  assert.equal(anonymousBoundary.split("browser.newPage").length - 1, 1);
  assert.equal(anonymousBoundary.split("await page.close()").length - 1, 1);
  assert(source.includes('new Counter("rate_limit_anonymous_boundary_attempts")'));
  assert(source.includes('new Counter("rate_limit_anonymous_boundary_admitted")'));
  assert(source.includes('new Counter("rate_limit_anonymous_boundary_limited")'));
});

test("authenticated rate-limit setup types into the controlled sign-in email field", () => {
  const source = readFileSync(new URL("../performance/k6/rate-limits.js", import.meta.url), "utf8");
  const clearIndex = source.indexOf('await emailField.fill("");');
  const typeIndex = source.indexOf("await emailField.type(email);");
  const focusSubmitIndex = source.indexOf("await submit.focus();", typeIndex);
  assert(source.includes('const emailField = page.locator("#email");'));
  assert(clearIndex >= 0);
  assert(typeIndex > clearIndex);
  assert(focusSubmitIndex > typeIndex);
  assert(source.includes('emailField.getAttribute("aria-invalid")) !== "false"'));
  assert.equal(source.includes('await page.locator("#email").fill(email)'), false);
  const boundaryStart = source.indexOf("async function runAuthenticatedBoundaries");
  const boundaryEnd = source.indexOf("function runAuthenticatedBoundaryRequests", boundaryStart);
  const lifecycle = source.slice(boundaryStart, boundaryEnd);
  assert(lifecycle.indexOf("runAuthenticatedBoundaryRequests(session)") < lifecycle.indexOf("await page.close()"));
  assert(source.includes("async function createAuthenticatedBrowserSession(page)"));
});

test("K6 rate-limit boundary thresholds match the API policies", () => {
  const script = readFileSync(new URL("../performance/k6/rate-limits.js", import.meta.url), "utf8");
  const applicationPolicy = readFileSync(
    new URL("../apps/api/src/modules/rate-limiting/domain/application-rate-limit-policy.ts", import.meta.url),
    "utf8",
  );
  const anonymousPolicy = readFileSync(
    new URL("../apps/api/src/modules/identity/infrastructure/prisma-anonymous-auth-rate-limiter.ts", import.meta.url),
    "utf8",
  );
  const applicationBoundaries = [
    ["key_material_mutation", 10, 300],
    ["account_mutation", 120, 60],
    ["vault_mutation", 30, 60],
    ["membership_mutation", 30, 60],
  ];
  for (const [operation, limit, windowSeconds] of applicationBoundaries) {
    assert.match(
      applicationPolicy,
      new RegExp(`${operation}:\\s*\\{\\s*limit:\\s*${limit}\\s*,\\s*windowSeconds:\\s*${windowSeconds}\\s*\\}`),
    );
    assert.match(script, new RegExp(`verifyPolicyBoundary\\("${operation}",\\s*${limit},`));
  }
  assert.match(anonymousPolicy, /const WINDOW_SECONDS = 15 \* 60;/);
  assert.match(anonymousPolicy, /operation: "magic-link-email", maximum: 5/);
  assert.match(anonymousPolicy, /operation: "magic-link-ip", maximum: 20/);
  assert.match(anonymousPolicy, /operation: "magic-link-unattributed", maximum: 20/);
  assert(script.includes("runAnonymousBoundary(5, true)"));
  assert(script.includes("runAnonymousBoundary(20, false)"));
});

test("K6 Mailpit capture records fixed milestones and accepts successful 2xx cleanup", () => {
  const common = readFileSync(new URL("../performance/k6/common.js", import.meta.url), "utf8");
  const flow = readFileSync(new URL("../performance/k6/browser-flows.js", import.meta.url), "utf8");
  const phases = [
    ["list_response_received", "first_time_magic_link_list_response_received"],
    ["list_parsed", "first_time_magic_link_list_parsed"],
    ["message_found", "first_time_magic_link_message_found"],
    ["message_id_validated", "first_time_magic_link_message_id_validated"],
    ["detail_received", "first_time_magic_link_detail_received"],
    ["detail_parsed", "first_time_magic_link_detail_parsed"],
    ["confirmation_link_found", "first_time_magic_link_confirmation_link_found"],
    ["url_parsed", "first_time_magic_link_url_parsed"],
    ["origin_validated", "first_time_magic_link_origin_validated"],
    ["path_validated", "first_time_magic_link_path_validated"],
    ["token_present", "first_time_magic_link_token_present"],
    ["action_url_validated", "first_time_magic_link_action_url_validated"],
    ["mailbox_cleared", "first_time_magic_link_mailbox_cleared"],
  ];
  for (const [phase, metric] of phases) {
    assert(common.includes(`recordDiagnostic("${phase}")`));
    assert(flow.includes(`new Counter("${metric}")`));
  }
  assert(common.includes("response.status < 200 || response.status >= 300"));
  assert(common.includes("body.match(/(https?):\\/\\/localhost:4000(\\/auth\\/confirm)#([^\\s\"'<>]+)/)"));
  assert(common.includes('const tokenPrefix = "token=";'));
  assert.equal(common.includes("new URL("), false);
  assert.equal(common.includes("new URLSearchParams("), false);
  assert.equal(common.includes("[200, 204].includes(response.status)"), false);
});

test("K6 first-time vault setup uses fixed secret-free progress and error diagnostics", () => {
  const source = readFileSync(new URL("../performance/k6/browser-flows.js", import.meta.url), "utf8");
  const counterNames = new Set(
    [...source.matchAll(/new Counter\(\s*"([a-z0-9_]+)"\s*,?\s*\)/g)].map((match) => match[1]),
  );
  for (const metric of [
    "first_time_vault_name_filled",
    "first_time_custom_passphrase_selected",
    "first_time_custom_passphrase_filled",
    "first_time_custom_passphrase_form_state_valid",
    "first_time_custom_passphrase_form_state_invalid",
    "first_time_custom_passphrase_form_state_probe_incomplete",
    "first_time_passphrase_confirmation_filled",
    "first_time_setup_acknowledgement_checked",
    "first_time_vault_setup_submit_probe_started",
    "first_time_vault_setup_submit_button_located",
    "first_time_vault_setup_submit_enabled",
    "first_time_vault_setup_submit_disabled",
    "first_time_vault_setup_submit_busy",
    "first_time_vault_setup_custom_mode_at_submit",
    "first_time_vault_setup_generated_mode_at_submit",
    "first_time_vault_setup_submit_clicked",
    "first_time_vault_setup_failure_diagnostics_started",
    "first_time_vault_setup_diagnostic_probe_incomplete",
    "first_time_vault_setup_submit_busy_at_timeout",
    "first_time_vault_initialization_error_visible",
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
    "first_time_vault_setup_validation_failed",
    "first_time_vault_setup_validation_vault_name_invalid",
    "first_time_vault_setup_validation_passphrase_invalid",
    "first_time_vault_setup_validation_confirmation_invalid",
    "first_time_vault_setup_validation_acknowledgement_invalid",
    "first_time_vault_setup_failure_surface_unclassified",
    "first_time_account_creation_link_visible",
    "first_time_account_creation_opened",
    "first_time_manual_uri_section_opened",
    "first_time_manual_uri_filled",
    "first_time_manual_uri_submit_enabled",
    "first_time_manual_uri_submit_clicked",
    "first_time_account_review_form_visible",
    "first_time_account_save_enabled",
  ])
    assert(counterNames.has(metric));
  assert(source.includes('acknowledgement.getAttribute("data-state")'));
  assert(source.includes('getAttribute("data-initialization-failure-category")'));
  assert(source.includes("data-personal-vault-initialization-error"));
  assert(source.includes('getAttribute("aria-invalid")'));
  assert(source.includes('getAttribute("aria-busy")'));
  assert(source.includes('getAttribute("disabled")'));
  assert(source.includes('getAttribute("data-personal-vault-passphrase-valid")'));
  assert(!source.includes("vaultSetupForm.locator("));
  assert(source.includes("page.locator('form:has(#vault-name) button[type=\"submit\"]')"));
  assert(source.includes("page.keyboard.type(passphrase)"));
  assert(source.includes("page.keyboard.type(uri)"));
  assert(source.includes('manualUriTrigger.getAttribute("data-state")'));
  assert(source.includes('[data-slot="vault-account-actions"] a[href="/vaults/accounts/new"]'));
  assert(source.includes('accountCreationLink.waitFor({ state: "visible", timeout: 15_000 })'));
  assert(source.includes('waitFor({ state: "visible", timeout: 15_000 })'));
  assert(source.includes('waitFor({ state: "visible", timeout: 5_000 })'));
  assert(source.includes('locator("#custom-secret")'));
  assert(source.includes("vaultInitializationErrorVisible.add(1)"));
  assert(source.includes('vaultInitializationFailureDiagnostics.get(failureCategory ?? "")'));
});

test("K6 controlled unlock input dispatches real keyboard input events", () => {
  const source = readFileSync(new URL("../performance/k6/browser-support.js", import.meta.url), "utf8");
  assert(source.includes('await input.fill("")'));
  assert(source.includes("await input.focus()"));
  assert(source.includes("await page.keyboard.type(passphrase)"));
});

test("first-time workflow reports the last fixed browser milestone and requires exactly two successful checks", () => {
  const milestoneNames = [
    "first_time_browser_page_created",
    "first_time_sign_in_page_loaded",
    "first_time_invalid_email_filled",
    "first_time_invalid_email_blurred",
    "first_time_sign_in_form_hydrated",
    "first_time_email_address_typed",
    "first_time_email_address_filled",
    "first_time_email_address_retained",
    "first_time_email_address_focused",
    "first_time_turnstile_ready",
    "first_time_email_focus_moved",
    "first_time_email_address_blurred",
    "first_time_email_validation_cleared",
    "first_time_email_validated",
    "first_time_passwordless_request_submitted",
    "first_time_passwordless_request_confirmed",
    "first_time_magic_link_list_response_received",
    "first_time_magic_link_list_parsed",
    "first_time_magic_link_message_found",
    "first_time_magic_link_message_id_validated",
    "first_time_magic_link_detail_received",
    "first_time_magic_link_detail_parsed",
    "first_time_magic_link_confirmation_link_found",
    "first_time_magic_link_url_parsed",
    "first_time_magic_link_origin_validated",
    "first_time_magic_link_path_validated",
    "first_time_magic_link_token_present",
    "first_time_magic_link_action_url_validated",
    "first_time_magic_link_mailbox_cleared",
    "first_time_magic_link_captured",
    "first_time_magic_link_redeemed",
    "first_time_vault_name_filled",
    "first_time_custom_passphrase_selected",
    "first_time_custom_passphrase_filled",
    "first_time_passphrase_confirmation_filled",
    "first_time_setup_acknowledgement_checked",
    "first_time_vault_setup_submit_enabled",
    "first_time_vault_setup_submit_clicked",
    "first_time_vault_initialized",
    "first_time_vault_unlocked",
    "first_time_account_creation_link_visible",
    "first_time_account_creation_opened",
    "first_time_manual_uri_section_opened",
    "first_time_manual_uri_filled",
    "first_time_manual_uri_submit_enabled",
    "first_time_manual_uri_submit_clicked",
    "first_time_account_review_form_visible",
    "first_time_account_save_enabled",
    "first_time_account_save_submitted",
  ];
  const failureDetails = [
    "first_time_browser_not_started",
    "first_time_sign_in_page_not_loaded",
    "first_time_sign_in_form_input_failed",
    "first_time_sign_in_form_blur_failed",
    "first_time_sign_in_form_not_hydrated",
    "first_time_email_typing_failed",
    "first_time_email_input_failed",
    "first_time_email_not_retained",
    "first_time_email_focus_failed",
    "first_time_turnstile_not_ready",
    "first_time_email_focus_move_failed",
    "first_time_email_blur_failed",
    "first_time_email_validation_not_observed",
    "first_time_email_not_validated",
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
    "first_time_passphrase_confirmation_not_filled",
    "first_time_setup_acknowledgement_not_checked",
    "first_time_vault_setup_submit_probe_not_started",
    "first_time_vault_setup_not_submitted",
    "first_time_vault_not_initialized",
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
  ];
  const setupSubmitFailureDetails = [
    "first_time_vault_setup_submit_not_enabled",
    "first_time_vault_setup_submit_probe_not_started",
    "first_time_vault_setup_submit_button_missing",
    "first_time_vault_setup_submit_probe_incomplete",
    "first_time_vault_setup_submit_busy",
    "first_time_vault_setup_custom_mode_not_selected",
    "first_time_vault_setup_submit_disabled_unclassified",
  ];
  const initializationFailureDetails = [
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
    "first_time_vault_initialization_still_pending",
    "first_time_vault_setup_diagnostic_probe_incomplete",
    "first_time_custom_passphrase_form_state_invalid",
    "first_time_custom_passphrase_form_state_probe_incomplete",
    "first_time_vault_setup_validation_vault_name_invalid",
    "first_time_vault_setup_validation_passphrase_invalid",
    "first_time_vault_setup_validation_confirmation_invalid",
    "first_time_vault_setup_validation_acknowledgement_invalid",
  ];
  const metricsFor = (names) => Object.fromEntries(names.map((name) => [name, { count: 1 }]));
  for (const failureDetail of [...failureDetails, ...setupSubmitFailureDetails, ...initializationFailureDetails]) {
    assert.equal(parseBrowserHelperFailurePhase(JSON.stringify({ failurePhase: failureDetail })), failureDetail);
  }
  const completeMetrics = {
    ...metricsFor(milestoneNames),
    first_time_otp_rendered: { count: 1 },
    first_time_assertion_block_started: { count: 1 },
    first_time_assertion_block_completed: { count: 1 },
    checks: { rate: 1, passes: 2, fails: 0 },
  };

  assert.equal(firstTimeAssertionFailureDetail({ metrics: completeMetrics }), null);
  const setupSubmitEnabledIndex = milestoneNames.indexOf("first_time_vault_setup_submit_enabled");
  assert.notEqual(setupSubmitEnabledIndex, -1);
  const setupSubmitFailureCases = [
    [{}, "first_time_vault_setup_submit_probe_not_started"],
    [{ first_time_vault_setup_submit_probe_started: { count: 1 } }, "first_time_vault_setup_submit_button_missing"],
    [
      {
        first_time_vault_setup_submit_probe_started: { count: 1 },
        first_time_vault_setup_submit_button_located: { count: 1 },
      },
      "first_time_vault_setup_submit_probe_incomplete",
    ],
    [
      {
        first_time_vault_setup_submit_probe_started: { count: 1 },
        first_time_vault_setup_submit_button_located: { count: 1 },
        first_time_vault_setup_submit_disabled: { count: 1 },
        first_time_vault_setup_submit_busy: { count: 1 },
      },
      "first_time_vault_setup_submit_busy",
    ],
    [
      {
        first_time_vault_setup_submit_probe_started: { count: 1 },
        first_time_vault_setup_submit_button_located: { count: 1 },
        first_time_vault_setup_submit_disabled: { count: 1 },
      },
      "first_time_vault_setup_custom_mode_not_selected",
    ],
    [
      {
        first_time_vault_setup_submit_probe_started: { count: 1 },
        first_time_vault_setup_submit_button_located: { count: 1 },
        first_time_vault_setup_submit_disabled: { count: 1 },
        first_time_vault_setup_custom_mode_at_submit: { count: 1 },
      },
      "first_time_vault_setup_submit_disabled_unclassified",
    ],
    [
      {
        first_time_vault_setup_submit_probe_started: { count: 1 },
        first_time_vault_setup_submit_button_located: { count: 1 },
        first_time_vault_setup_submit_disabled: { count: 1 },
        first_time_vault_setup_validation_failed: { count: 1 },
        first_time_vault_setup_validation_confirmation_invalid: { count: 1 },
      },
      "first_time_vault_setup_validation_confirmation_invalid",
    ],
  ];
  for (const [diagnostics, expected] of setupSubmitFailureCases) {
    assert.equal(
      firstTimeAssertionFailureDetail({
        metrics: { ...metricsFor(milestoneNames.slice(0, setupSubmitEnabledIndex)), ...diagnostics },
      }),
      expected,
    );
  }
  const initializationIndex = milestoneNames.indexOf("first_time_vault_initialized");
  assert.notEqual(initializationIndex, -1);
  const setupDiagnosticFailureCases = [
    ["first_time_custom_passphrase_form_state_invalid", "first_time_custom_passphrase_form_state_invalid"],
    [
      "first_time_custom_passphrase_form_state_probe_incomplete",
      "first_time_custom_passphrase_form_state_probe_incomplete",
    ],
    ["first_time_vault_setup_submit_busy_at_timeout", "first_time_vault_initialization_still_pending"],
    ["first_time_vault_setup_diagnostic_probe_incomplete", "first_time_vault_setup_diagnostic_probe_incomplete"],
  ];
  for (const [metric, detail] of setupDiagnosticFailureCases) {
    assert.equal(
      firstTimeAssertionFailureDetail({
        metrics: { ...metricsFor(milestoneNames.slice(0, initializationIndex)), [metric]: { count: 1 } },
      }),
      detail,
    );
  }
  assert.equal(
    firstTimeAssertionFailureDetail({
      metrics: {
        ...metricsFor(milestoneNames.slice(0, initializationIndex)),
        first_time_vault_initialization_error_visible: { count: 1 },
      },
    }),
    "first_time_vault_initialization_rejected",
  );
  const initializationFailureCases = [
    ["first_time_vault_initialization_client_crypto_failure", "first_time_vault_initialization_client_crypto_failure"],
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
    ["first_time_vault_initialization_failure_unclassified", "first_time_vault_initialization_failure_unclassified"],
  ];
  for (const [metric, detail] of initializationFailureCases) {
    assert.equal(
      firstTimeAssertionFailureDetail({
        metrics: {
          ...metricsFor(milestoneNames.slice(0, initializationIndex)),
          first_time_vault_initialization_error_visible: { count: 1 },
          [metric]: { count: 1 },
        },
      }),
      detail,
    );
  }
  const setupValidationFailureCases = [
    ["first_time_vault_setup_validation_vault_name_invalid", "first_time_vault_setup_validation_vault_name_invalid"],
    ["first_time_vault_setup_validation_passphrase_invalid", "first_time_vault_setup_validation_passphrase_invalid"],
    [
      "first_time_vault_setup_validation_confirmation_invalid",
      "first_time_vault_setup_validation_confirmation_invalid",
    ],
    [
      "first_time_vault_setup_validation_acknowledgement_invalid",
      "first_time_vault_setup_validation_acknowledgement_invalid",
    ],
  ];
  for (const [metric, detail] of setupValidationFailureCases) {
    assert.equal(
      firstTimeAssertionFailureDetail({
        metrics: {
          ...metricsFor(milestoneNames.slice(0, initializationIndex)),
          first_time_vault_setup_validation_failed: { count: 1 },
          [metric]: { count: 1 },
        },
      }),
      detail,
    );
  }
  assert.equal(
    firstTimeAssertionFailureDetail({
      metrics: {
        ...metricsFor(milestoneNames.slice(0, initializationIndex)),
        first_time_vault_setup_failure_surface_unclassified: { count: 1 },
      },
    }),
    "first_time_vault_initialization_failure_unclassified",
  );
  assert.equal(firstTimeAssertionFailureDetail(null), "first_time_summary_missing");
  for (let completed = 0; completed < failureDetails.length; completed += 1) {
    assert.equal(
      firstTimeAssertionFailureDetail({ metrics: metricsFor(milestoneNames.slice(0, completed)) }),
      failureDetails[completed],
    );
  }
  assert.equal(
    firstTimeAssertionFailureDetail({
      metrics: {
        ...metricsFor(milestoneNames),
        first_time_otp_rendered: { count: 1 },
        first_time_assertion_block_started: { count: 1 },
      },
    }),
    "first_time_assertion_block_incomplete",
  );
  assert.equal(
    firstTimeAssertionFailureDetail({
      metrics: {
        ...metricsFor(milestoneNames),
        first_time_otp_rendered: { count: 1 },
        first_time_assertion_block_started: { count: 1 },
        first_time_assertion_block_completed: { count: 1 },
        checks: { rate: 0, passes: 0, fails: 0 },
      },
    }),
    "first_time_check_observations_missing",
  );
  assert.equal(
    firstTimeAssertionFailureDetail({
      metrics: { ...completeMetrics, checks: { rate: 0.5, passes: 1, fails: 1 } },
    }),
    "first_time_assertions_failed",
  );
});

test("rate-limit report validation requires complete exact boundary observations", () => {
  const cases = [
    ["email", "rate_limit_anonymous_boundary", 6, 5, 1],
    ["network", "rate_limit_anonymous_boundary", 21, 20, 1],
    ["authenticated", "rate_limit_key_material_mutation", 11, 10, 1],
    ["authenticated", "rate_limit_account_mutation", 121, 120, 1],
    ["authenticated", "rate_limit_vault_mutation", 31, 30, 1],
    ["authenticated", "rate_limit_membership_mutation", 31, 30, 1],
  ];
  const metrics = Object.fromEntries(
    cases.slice(2).flatMap(([, prefix, attempts, admitted, limited]) => [
      [`${prefix}_attempts`, { count: attempts }],
      [`${prefix}_admitted`, { count: admitted }],
      [`${prefix}_limited`, { count: limited }],
    ]),
  );
  for (const [boundary, prefix, attempts, admitted, limited] of cases.slice(0, 2)) {
    metrics[`${prefix}_attempts`] = { count: attempts };
    metrics[`${prefix}_admitted`] = { count: admitted };
    metrics[`${prefix}_limited`] = { count: limited };
    assert.equal(rateLimitAssertionFailureDetail({ metrics }, boundary), null);
    delete metrics[`${prefix}_attempts`];
    delete metrics[`${prefix}_admitted`];
    delete metrics[`${prefix}_limited`];
  }
  assert.equal(rateLimitAssertionFailureDetail({ metrics }, "authenticated"), null);
  assert.equal(rateLimitAssertionFailureDetail(null, "email"), "rate_limit_summary_missing");
  assert.equal(rateLimitAssertionFailureDetail({ metrics: {} }, "unsupported"), "rate_limit_boundary_unsupported");

  const emailMetrics = {
    rate_limit_anonymous_boundary_attempts: { count: 6 },
    rate_limit_anonymous_boundary_admitted: { count: 5 },
    rate_limit_anonymous_boundary_limited: { count: 1 },
  };
  assert.equal(
    rateLimitAssertionFailureDetail(
      { metrics: { ...emailMetrics, rate_limit_anonymous_boundary_attempts: { count: 5 } } },
      "email",
    ),
    "rate_limit_boundary_attempt_count_mismatch",
  );
  assert.equal(
    rateLimitAssertionFailureDetail(
      { metrics: { ...emailMetrics, rate_limit_anonymous_boundary_admitted: { count: 4 } } },
      "email",
    ),
    "rate_limit_boundary_admitted_count_mismatch",
  );
  assert.equal(
    rateLimitAssertionFailureDetail(
      { metrics: { ...emailMetrics, rate_limit_anonymous_boundary_limited: { count: 0 } } },
      "email",
    ),
    "rate_limit_boundary_limited_count_mismatch",
  );
  assert.equal(rateLimitAssertionFailureDetail({ metrics: {} }, "email"), "rate_limit_boundary_observations_missing");
});

test("magic-link request observation matches only its exact same-origin POST path", () => {
  const target = "http://localhost:4000";
  assert.equal(isMagicLinkRequestTarget("POST", `${target}/api/v1/auth/magic-link/request`, target), true);
  assert.equal(isMagicLinkRequestTarget("GET", `${target}/api/v1/auth/magic-link/request`, target), false);
  assert.equal(isMagicLinkRequestTarget("POST", `${target}/api/v1/auth/magic-link/redeem`, target), false);
  assert.equal(isMagicLinkRequestTarget("POST", "http://localhost:3000/api/v1/auth/magic-link/request", target), false);
  assert.equal(isMagicLinkRequestTarget("POST", "not a URL", target), false);
});

test("auth request observation classifies same-origin API paths without retaining request URLs", () => {
  const target = "http://localhost:4000";
  assert.equal(isSameOriginAuthPostTarget("POST", `${target}/api/v1/auth/magic-link/request`, target), true);
  assert.equal(isSameOriginAuthPostTarget("POST", `${target}/api/v1/auth/pwa/session`, target), true);
  assert.equal(isSameOriginAuthPostTarget("GET", `${target}/api/v1/auth/magic-link/request`, target), false);
  assert.equal(isSameOriginAuthPostTarget("POST", `${target}/api/v1/authentication`, target), false);
  assert.equal(isSameOriginAuthPostTarget("POST", "http://localhost:3000/api/v1/auth/session", target), false);
  assert.equal(isSameOriginAuthPostTarget("POST", "not a URL", target), false);
});

test("Shared Vault creation observation matches only its exact same-origin POST path", () => {
  const target = "http://localhost:4000";
  assert.equal(isSharedVaultCreationRequestTarget("POST", `${target}/api/v1/shared-vaults`, target), true);
  assert.equal(isSharedVaultCreationRequestTarget("GET", `${target}/api/v1/shared-vaults`, target), false);
  assert.equal(isSharedVaultCreationRequestTarget("POST", `${target}/api/v1/shared-vaults/member`, target), false);
  assert.equal(isSharedVaultCreationRequestTarget("POST", "http://localhost:3000/api/v1/shared-vaults", target), false);
  assert.equal(isSharedVaultCreationRequestTarget("POST", "not a URL", target), false);
});

test("Shared Vault invitation request observation matches only same-origin creation POSTs", () => {
  const target = "http://localhost:4000";
  const path = `${target}/api/v1/shared-vaults/0123456789abcdef/share-links`;
  assert.equal(isSharedVaultInvitationCreationRequestTarget("POST", path, target), true);
  assert.equal(isSharedVaultInvitationCreationRequestTarget("GET", path, target), false);
  assert.equal(
    isSharedVaultInvitationCreationRequestTarget("POST", `${target}/api/v1/shared-vaults/short/share-links`, target),
    false,
  );
  assert.equal(
    isSharedVaultInvitationCreationRequestTarget("POST", `http://localhost:3000${new URL(path).pathname}`, target),
    false,
  );
  assert.equal(isSharedVaultInvitationCreationRequestTarget("POST", "not a URL", target), false);
});

test("Shared invitation fixture targets the accessible recipient field and submit action", () => {
  const browserSupport = readFileSync(
    new URL("../apps/web/scripts/load-test-browser-support.mjs", import.meta.url),
    "utf8",
  );
  assert.match(browserSupport, /const recipientField = page\.getByLabel\("Email penerima"\);/);
  assert(browserSupport.includes('const invitationForm = page.locator("form").filter({ has: recipientField });'));
  assert(
    browserSupport.includes('invitationForm.getByRole("button", { name: /^(Buat undangan|Create invitation)$/ })'),
  );
  assert(browserSupport.includes(`: invitationForm.locator('button[type="submit"]');`));
  assert(browserSupport.includes("shouldRetrySharedInvitationSubmitWithKeyboard({"));
  assert(browserSupport.includes('await submitButton.press("Enter", { timeout: 5_000 });'));
  assert(browserSupport.includes("installInvitationSubmitProbe(invitationForm)"));
  assert(browserSupport.includes("sameOriginApiPostObserved"));
  assert(browserSupport.includes("requestInvitationFormSubmit(invitationForm)"));
  assert(browserSupport.includes("event.preventDefault()"));
  assert(browserSupport.includes("recipient.form === form && submit.form === form"));
});

test("Shared Vault submit failures map only to fixed control-state categories", () => {
  assert.equal(
    classifySharedInvitationSubmitFailure({
      requestObserved: false,
      buttonCount: 0,
      buttonVisible: false,
      buttonDisabled: true,
      recipientInvalid: false,
    }),
    "shared_invitation_submit_button_missing",
  );
  assert.equal(
    classifySharedInvitationSubmitFailure({
      requestObserved: false,
      buttonCount: 1,
      buttonVisible: false,
      buttonDisabled: true,
      recipientInvalid: false,
    }),
    "shared_invitation_submit_button_hidden",
  );
  assert.equal(
    classifySharedInvitationSubmitFailure({
      requestObserved: false,
      buttonCount: 1,
      buttonVisible: true,
      buttonDisabled: true,
      recipientInvalid: false,
    }),
    "shared_invitation_submit_button_disabled",
  );
  assert.equal(
    classifySharedInvitationSubmitFailure({
      requestObserved: false,
      buttonCount: 1,
      buttonVisible: true,
      buttonDisabled: true,
      recipientInvalid: true,
    }),
    "shared_invitation_recipient_rejected",
  );
  assert.equal(
    classifySharedInvitationSubmitFailure({
      requestObserved: true,
      buttonCount: 1,
      buttonVisible: true,
      buttonDisabled: false,
      recipientInvalid: false,
    }),
    "shared_invitation_submit_request_observed",
  );
});

test("Shared invitation keyboard fallback is limited to safe pointer-interception recovery", () => {
  const conditions = {
    failurePhase: "shared_invitation_submit_click_intercepted",
    requestObserved: false,
    buttonCount: 1,
    buttonVisible: true,
    buttonDisabled: false,
    recipientInvalid: false,
  };
  assert.equal(shouldRetrySharedInvitationSubmitWithKeyboard(conditions), true);
  assert.equal(shouldRetrySharedInvitationSubmitWithKeyboard({ ...conditions, requestObserved: true }), false);
  assert.equal(shouldRetrySharedInvitationSubmitWithKeyboard({ ...conditions, buttonDisabled: true }), false);
  assert.equal(shouldRetrySharedInvitationSubmitWithKeyboard({ ...conditions, recipientInvalid: true }), false);
  assert.equal(shouldRetrySharedInvitationSubmitWithKeyboard({ ...conditions, buttonCount: 2 }), false);
  assert.equal(
    shouldRetrySharedInvitationSubmitWithKeyboard({
      ...conditions,
      failurePhase: "shared_invitation_submit_click_timeout",
    }),
    false,
  );
});

test("Shared invitation event diagnostics reveal only bounded dispatch categories", () => {
  const base = {
    probeAvailable: true,
    sameOriginApiPostObserved: false,
    buttonClickObserved: false,
    keyboardFallbackAttempted: false,
    enterKeyObserved: false,
    submitEventObserved: false,
    requestSubmitFallbackAttempted: false,
  };
  assert.equal(
    classifySharedInvitationEventOutcome({ ...base, sameOriginApiPostObserved: true }),
    "shared_invitation_request_target_mismatch",
  );
  assert.equal(
    classifySharedInvitationEventOutcome({ ...base, submitEventObserved: true }),
    "shared_invitation_submit_event_no_request",
  );
  assert.equal(
    classifySharedInvitationEventOutcome({ ...base, buttonClickObserved: true }),
    "shared_invitation_button_click_no_submit",
  );
  assert.equal(
    classifySharedInvitationEventOutcome({ ...base, keyboardFallbackAttempted: true, enterKeyObserved: true }),
    "shared_invitation_enter_without_submit",
  );
  assert.equal(
    classifySharedInvitationEventOutcome({ ...base, keyboardFallbackAttempted: true }),
    "shared_invitation_keyboard_event_not_observed",
  );
  assert.equal(
    classifySharedInvitationEventOutcome({ ...base, requestSubmitFallbackAttempted: true }),
    "shared_invitation_request_submit_not_observed",
  );
  assert.equal(classifySharedInvitationEventOutcome(base), "shared_invitation_activation_not_observed");
  assert.equal(
    classifySharedInvitationEventOutcome({ ...base, probeAvailable: false }),
    "shared_invitation_event_probe_unavailable",
  );
});

test("Shared invitation requestSubmit fallback requires a valid unique associated control set", () => {
  const safe = {
    requestObserved: false,
    sameOriginApiPostObserved: false,
    submitEventObserved: false,
    formControlsAssociated: true,
    buttonCount: 1,
    buttonVisible: true,
    buttonDisabled: false,
    recipientInvalid: false,
    recipientNativeValid: true,
  };
  assert.equal(shouldRequestSharedInvitationSubmit(safe), true);
  for (const unsafe of [
    { requestObserved: true },
    { sameOriginApiPostObserved: true },
    { submitEventObserved: true },
    { formControlsAssociated: false },
    { buttonCount: 0 },
    { buttonCount: 2 },
    { buttonVisible: false },
    { buttonDisabled: true },
    { recipientInvalid: true },
    { recipientNativeValid: false },
  ])
    assert.equal(shouldRequestSharedInvitationSubmit({ ...safe, ...unsafe }), false);
});

test("Shared Vault click errors map only to fixed actionability categories", () => {
  assert.equal(
    classifySharedInvitationClickError(new Error("strict mode violation: synthetic locator")),
    "shared_invitation_submit_multiple_buttons",
  );
  assert.equal(
    classifySharedInvitationClickError(new Error("synthetic overlay intercepts pointer events")),
    "shared_invitation_submit_click_intercepted",
  );
  assert.equal(
    classifySharedInvitationClickError(new Error("element is not attached to the DOM")),
    "shared_invitation_submit_button_detached",
  );
  assert.equal(
    classifySharedInvitationClickError(new Error("element is not stable")),
    "shared_invitation_submit_button_unstable",
  );
  assert.equal(
    classifySharedInvitationClickError(Object.assign(new Error("synthetic timeout"), { name: "TimeoutError" })),
    "shared_invitation_submit_click_timeout",
  );
  assert.equal(
    classifySharedInvitationClickError(new Error("synthetic private detail")),
    "shared_invitation_submit_click_failed",
  );
});

test("Shared Vault click surface maps only to fixed bounded outcomes", () => {
  const visibleButton = { connected: true, centerInViewport: true, hitTargetMatchesButton: true };
  const failure = (overrides) =>
    classifySharedInvitationSubmitFailure({
      requestObserved: false,
      buttonCount: 1,
      buttonVisible: true,
      buttonDisabled: false,
      recipientInvalid: false,
      clickFailure: "shared_invitation_submit_click_timeout",
      clickSurface: visibleButton,
      ...overrides,
    });
  assert.equal(failure({ buttonCount: 2 }), "shared_invitation_submit_multiple_buttons");
  assert.equal(
    failure({ clickSurface: { ...visibleButton, connected: false } }),
    "shared_invitation_submit_button_detached",
  );
  assert.equal(
    failure({ clickSurface: { ...visibleButton, centerInViewport: false } }),
    "shared_invitation_submit_button_outside_viewport",
  );
  assert.equal(
    failure({ clickSurface: { ...visibleButton, hitTargetMatchesButton: false } }),
    "shared_invitation_submit_click_intercepted",
  );
  assert.equal(failure({}), "shared_invitation_submit_click_timeout");
  assert.equal(failure({ clickFailure: "untrusted-phase" }), "shared_invitation_submit_click_failed");
});

test("Shared Vault invitation responses map only to fixed status categories", () => {
  assert.equal(classifySharedVaultInvitationStatus(201), null);
  assert.equal(classifySharedVaultInvitationStatus(400), "shared_invitation_validation_rejected");
  assert.equal(classifySharedVaultInvitationStatus(401), "shared_invitation_unauthenticated");
  assert.equal(classifySharedVaultInvitationStatus(403), "shared_invitation_forbidden");
  assert.equal(classifySharedVaultInvitationStatus(404), "shared_invitation_not_found");
  assert.equal(classifySharedVaultInvitationStatus(409), "shared_invitation_conflict");
  assert.equal(classifySharedVaultInvitationStatus(429), "shared_invitation_rate_limited");
  assert.equal(classifySharedVaultInvitationStatus(503), "shared_invitation_server_error");
});

test("Shared Vault route matching excludes the static creation path and validates opaque IDs", () => {
  assert.equal(isSharedVaultManagementDetailsPath("/vaults/manage/0123456789abcdef"), true);
  assert.equal(isSharedVaultManagementDetailsPath("/vaults/manage/new"), false);
  assert.equal(isSharedVaultManagementDetailsPath("/vaults/manage/short"), false);
  assert.equal(isSharedVaultManagementDetailsPath("/vaults/manage/../new"), false);
});

test("Shared Vault creation responses map only to fixed status categories", () => {
  assert.equal(classifySharedVaultCreationStatus(201), null);
  assert.equal(classifySharedVaultCreationStatus(400), "shared_creation_validation_rejected");
  assert.equal(classifySharedVaultCreationStatus(401), "shared_creation_unauthenticated");
  assert.equal(classifySharedVaultCreationStatus(403), "shared_creation_forbidden");
  assert.equal(classifySharedVaultCreationStatus(409), "shared_creation_conflict");
  assert.equal(classifySharedVaultCreationStatus(429), "shared_creation_rate_limited");
  assert.equal(classifySharedVaultCreationStatus(503), "shared_creation_server_error");
  assert.equal(classifySharedVaultCreationStatus(302), "shared_creation_unexpected_status");
});

test("Shared Vault unlock diagnostics distinguish missing passphrase inputs from lock failures", () => {
  assert.equal(
    classifySharedVaultUnlockOutcome({
      passphraseVisible: false,
      passphraseRejected: false,
      hasAlert: true,
      reportedFailurePhase: null,
    }),
    "shared_creation_unlock_alert_without_input",
  );
  assert.equal(
    classifySharedVaultUnlockOutcome({
      passphraseVisible: false,
      passphraseRejected: false,
      hasAlert: true,
      reportedFailurePhase: null,
      sharedVaultPresence: "present",
    }),
    "shared_creation_unlock_workspace_omitted_vault",
  );
  assert.equal(
    classifySharedVaultUnlockOutcome({
      passphraseVisible: false,
      passphraseRejected: false,
      hasAlert: true,
      reportedFailurePhase: null,
      sharedVaultPresence: "missing",
    }),
    "shared_creation_unlock_membership_missing",
  );
  assert.equal(
    classifySharedVaultUnlockOutcome({
      passphraseVisible: false,
      passphraseRejected: false,
      hasAlert: false,
      reportedFailurePhase: null,
    }),
    "shared_creation_unlock_tabs_unavailable",
  );
  assert.equal(
    classifySharedVaultUnlockOutcome({
      passphraseVisible: true,
      passphraseRejected: true,
      hasAlert: true,
      reportedFailurePhase: null,
    }),
    "shared_creation_unlock_input_rejected",
  );
  assert.equal(
    classifySharedVaultUnlockOutcome({
      passphraseVisible: true,
      passphraseRejected: false,
      hasAlert: false,
      reportedFailurePhase: "shared_creation_unlock_sync_failure",
    }),
    "shared_creation_unlock_sync_failure",
  );
});

test("workspace unlock diagnostics map known failure codes to fixed phases", () => {
  assert.equal(classifyWorkspaceUnlockFailureCode("invalid_secret"), "shared_creation_unlock_passphrase_rejected");
  assert.equal(classifyWorkspaceUnlockFailureCode("sync_failed"), "shared_creation_unlock_sync_failure");
  assert.equal(
    classifyWorkspaceUnlockFailureCode("user_encryption_key_decryption_failed"),
    "shared_creation_unlock_identity_failure",
  );
  assert.equal(classifyWorkspaceUnlockFailureCode("private data"), null);
  assert.equal(classifyWorkspaceUnlockFailureCode(undefined), null);
});

test("SMTP startup preflight accepts only its one expected recipient and verifies an empty mailbox", () => {
  const recipient = "smtp-preflight@loadtest.invalid";
  assert.equal(
    mailpitPreflightMessageCaptured({ messages: [{ To: [{ Address: recipient.toUpperCase() }] }] }, recipient),
    true,
  );
  assert.equal(mailpitPreflightMessageCaptured({ messages: [] }, recipient), false);
  assert.equal(
    mailpitPreflightMessageCaptured(
      { messages: [{ To: [{ Address: recipient }] }, { To: [{ Address: recipient }] }] },
      recipient,
    ),
    false,
  );
  assert.equal(
    mailpitPreflightMessageCaptured({ messages: [{ To: [{ Address: "elsewhere@example.test" }] }] }, recipient),
    false,
  );
  assert.equal(mailpitPreflightMessageCaptured({ messages: "invalid" }, recipient), false);
  assert.equal(mailpitMessageListIsEmpty({ messages: [] }), true);
  assert.equal(mailpitMessageListIsEmpty({ messages: [{ To: [] }] }), false);
  assert.equal(mailpitMessageListIsEmpty(null), false);
});

test("migration Docker stats accept only the exact run-owned one-shot container", () => {
  const project = "rhasia-load-012345abcdef";
  assert.deepEqual(parseMigrationDockerStats(`${project}-migrate-run-0123456789ab|0.25%|128MiB / 2GiB|0.4%`, project), [
    { cpuPercent: "0.25%", cpuPercentValue: 0.25, memoryUsage: "128MiB / 2GiB", memoryMiB: 128 },
  ]);
  assert.deepEqual(
    parseMigrationDockerStats("rhasia-load-ffffffffffff-migrate-run-0123456789ab|1%|1MiB / 2GiB|1%", project),
    [],
  );
  assert.deepEqual(parseMigrationDockerStats(`${project}-api-1|1%|1MiB / 2GiB|1%`, project), []);
  assert.deepEqual(parseMigrationDockerStats(`${project}-migrate-run-0123456789ab|90000%|1MiB / 2GiB|1%`, project), []);
});

test("runner process snapshots accept only bounded CPU and resident-memory readings", () => {
  assert.deepEqual(parseProcessUsage(" 12.5 2048\n"), { cpuPercent: 12.5, residentMemoryBytes: 2_097_152 });
  for (const output of ["", "cpu 2048", "12 2048 extra", "-1 2048", "10001 2048", "12 -1", "12 9007199254740991"])
    assert.equal(parseProcessUsage(output), null);
});

test("capacity profile records the explicit VU ceiling and duration without browser users", () => {
  assert.deepEqual(scenarioProfile({ scenario: "capacity", maxVus: 18, duration: "7m" }), {
    maxVus: 18,
    duration: "7m",
    browserVus: 0,
  });
});

test("capacity report preserves generator, stack, tool, and saturation evidence fields", () => {
  const source = readFileSync(new URL("./load-test.mjs", import.meta.url), "utf8");
  for (const field of [
    "runnerPlacement: state.runnerPlacement",
    "networkPath:",
    "loadGenerator: machineSummary()",
    "stackHost: stackHostSummary(project, state)",
    "versions: { k6: k6Version, browserModule:",
    "dockerSnapshots: []",
    "postgresSnapshots: []",
    "k6ProcessSnapshots: []",
    "sshTunnelProcessSnapshots: []",
    "captureResourceSnapshots(runRecord, project, state)",
    "aggregateRateLimitMetrics(project, state)",
  ])
    assert(source.includes(field), `capacity report is missing ${field}`);
});

test("capacity mode requires capped resources for same-machine runs and bounds ceiling and duration", () => {
  const separateRunner = { runnerPlacement: "separate-runner" };
  assert.equal(
    validateScenario(
      { scenario: "capacity", "max-vus": "20", duration: "10m", "confirm-high-vus": "20" },
      separateRunner,
    ).maxVus,
    20,
  );
  assert.throws(() =>
    validateScenario(
      { scenario: "capacity", "max-vus": "20", duration: "10m", "confirm-high-vus": "19" },
      separateRunner,
    ),
  );
  assert.throws(() =>
    validateScenario(
      { scenario: "capacity", "max-vus": "21", duration: "5m", "confirm-high-vus": "21" },
      separateRunner,
    ),
  );
  assert.throws(() =>
    validateScenario(
      { scenario: "capacity", "max-vus": "11", duration: "601s", "confirm-high-vus": "11" },
      separateRunner,
    ),
  );
  assert.throws(() =>
    validateScenario(
      { scenario: "capacity", "max-vus": "11", duration: "0s", "confirm-high-vus": "11" },
      separateRunner,
    ),
  );
  assert.throws(() =>
    validateScenario(
      { scenario: "capacity", "max-vus": "11", duration: "5m", "confirm-high-vus": "11" },
      { runnerPlacement: "same-machine" },
    ),
  );
  assert.equal(
    validateScenario(
      { scenario: "capacity", "max-vus": "11", duration: "5m", "confirm-high-vus": "11" },
      { runnerPlacement: "same-machine", resourceProfile: LOADTEST_RESOURCE_PROFILE },
    ).maxVus,
    11,
  );
  assert.deepEqual(LOADTEST_SERVICE_RESOURCE_LIMITS, {
    db: { cpus: "2.0", memory: "3g" },
    migrate: { cpus: "2.0", memory: "2g" },
    api: { cpus: "1.5", memory: "2g" },
    web: { cpus: "2.0", memory: "2g" },
    "retention-purge": { cpus: "0.25", memory: "256m" },
    mailpit: { cpus: "0.5", memory: "512m" },
  });
});

test("higher VU ceilings require exact opt-in and the default profile stays bounded", () => {
  assert.equal(validateHighCeiling("10"), 10);
  assert.throws(() => validateHighCeiling("11"));
  assert.equal(validateHighCeiling("11", "11"), 11);
  assert.throws(() => validateHighCeiling("1001", "1001"));
  assert.throws(() => validateHighCeiling("+11", "11"));
  assert.throws(() => validateHighCeiling("20"));
  assert.equal(defaultProfile().rampBetweenStages, "10s");
  assert.deepEqual(defaultProfile().stages, [
    { targetVus: 1, hold: "2m" },
    { targetVus: 5, hold: "2m" },
    { targetVus: 10, hold: "2m" },
  ]);
});
