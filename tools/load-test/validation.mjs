import { LoadTestError } from "./errors.mjs";
import {
  BOOLEAN_OPTIONS,
  LOADTEST_RESOURCE_PROFILE,
  MAX_CAPACITY_SESSION_POOL_SIZE,
  MAX_CAPACITY_VUS,
  MAX_MIGRATION_STATS_SAMPLES,
  PROJECT_PATTERN,
  SCENARIOS,
  VALUE_OPTIONS,
  WEB_ORIGIN,
} from "./settings.mjs";

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
  if (typeof maxVus !== "string" || !/^(?:[1-9]|[1-9][0-9]|100)$/.test(maxVus))
    throw new LoadTestError(
      `The VU ceiling must be an integer from 1 to ${MAX_CAPACITY_VUS}; capacity uses at most ${MAX_CAPACITY_SESSION_POOL_SIZE} distinct sessions.`,
    );
  const value = Number(maxVus);
  if (value > 10 && confirmation !== String(value))
    throw new LoadTestError("A ceiling above 10 VUs requires --confirm-high-vus with the exact ceiling.");
  return value;
}

export function parseArguments(argv) {
  const [command, ...rest] = argv;
  if (!command) return { command: "all", options: {} };
  if (command === "help" || command === "--help" || command === "-h") return { command: "help", options: {} };
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

export function requiredOption(options, name) {
  if (typeof options[name] !== "string" || options[name].length === 0)
    throw new LoadTestError(`Missing required --${name}.`);
  return options[name];
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

export function validateRunnerPlacementOption(options, state) {
  if (options["runner-placement"] !== undefined && options["runner-placement"] !== state.runnerPlacement)
    throw new LoadTestError("Runner placement must match the run-owned Docker context.");
}

export function isValidMigrationDockerPeak(value) {
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

export function shouldPreserveFailedRun(options) {
  return options["preserve-on-failure"] === true || options["keep-stack"] === true;
}

export function validateFreshScenarioState(state) {
  if (state.loadScenarioStartedAt)
    throw new LoadTestError(
      "Each disposable database permits exactly one load scenario; create a fresh run for the next scenario or boundary group.",
    );
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
