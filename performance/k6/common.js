import http from "k6/http";
import { sleep } from "k6";
import { randomBytes } from "k6/crypto";
import { b64encode } from "k6/encoding";

export const BASE_URL = __ENV.LOADTEST_TARGET;
export const MAILPIT_ORIGIN = __ENV.LOADTEST_MAILPIT_ORIGIN;
export const PROJECT_ID = __ENV.LOADTEST_PROJECT_ID;
export const SYSTEM_TAGS = ["method", "name", "scenario", "status", "check"];
export const SUMMARY_TREND_STATS = ["avg", "min", "med", "max", "p(90)", "p(95)", "p(99)"];
export const SESSION_COOKIE_NAMES = [
  "rhsia-passwordless-access",
  "rhsia-passwordless-refresh",
  "rhsia-passwordless-assertion",
];

if (BASE_URL !== "http://localhost:4000" || MAILPIT_ORIGIN !== "http://localhost:8025")
  throw new Error("The load test must target its confirmed localhost ports.");
if (!/^rhasia-load-[0-9a-f]{12,32}$/.test(PROJECT_ID)) throw new Error("The load test project is not run-owned.");

export const normalThresholds = {
  http_req_failed: [{ threshold: "rate<0.01", abortOnFail: true, delayAbortEval: "30s" }],
};

function hasSession(session) {
  return (
    session &&
    typeof session.cookie === "string" &&
    session.cookie.length <= 8_192 &&
    SESSION_COOKIE_NAMES.every((name) => session.cookie.includes(`${name}=`)) &&
    typeof session.vaultId === "string" &&
    session.vaultId.length > 0 &&
    session.vaultId.length <= 128
  );
}

export function readSharedFixtures() {
  let fixtures;
  try {
    fixtures = JSON.parse(__ENV.LOADTEST_SHARED_FIXTURES);
  } catch {
    throw new Error("The in-memory Shared Vault fixtures are unavailable.");
  }
  if (
    !fixtures ||
    typeof fixtures.sharedVaultId !== "string" ||
    fixtures.sharedVaultId.length < 1 ||
    fixtures.sharedVaultId.length > 128 ||
    !hasSession(fixtures.owner) ||
    !Array.isArray(fixtures.members) ||
    fixtures.members.length !== 10 ||
    fixtures.members.some((member) => !hasSession(member)) ||
    new Set([fixtures.owner, ...fixtures.members].map((member) => member.cookie)).size !== 11 ||
    new Set([fixtures.owner, ...fixtures.members].map((member) => member.vaultId)).size !== 11
  )
    throw new Error("The in-memory Shared Vault fixtures failed bounded validation.");
  return fixtures;
}

export function readSharedMutationFixtures() {
  let fixtures;
  try {
    fixtures = JSON.parse(__ENV.LOADTEST_SHARED_FIXTURES);
  } catch {
    throw new Error("The in-memory Shared Vault mutation fixtures are unavailable.");
  }
  if (
    !fixtures ||
    !Array.isArray(fixtures.subjects) ||
    fixtures.subjects.length !== 10 ||
    fixtures.subjects.some(
      (subject) =>
        !hasSession(subject) ||
        typeof subject.sharedVaultId !== "string" ||
        subject.sharedVaultId.length < 1 ||
        subject.sharedVaultId.length > 128,
    ) ||
    new Set(fixtures.subjects.map((subject) => subject.cookie)).size !== 10 ||
    new Set(fixtures.subjects.map((subject) => subject.vaultId)).size !== 10 ||
    new Set(fixtures.subjects.map((subject) => subject.sharedVaultId)).size !== 10
  )
    throw new Error("The in-memory Shared Vault mutation fixtures failed bounded validation.");
  return fixtures;
}

export function readSessionPool() {
  let pool;
  try {
    pool = JSON.parse(__ENV.LOADTEST_SESSION_POOL);
  } catch {
    throw new Error("The in-memory session pool is unavailable.");
  }
  if (
    !pool ||
    !Array.isArray(pool.sessions) ||
    pool.sessions.length < 1 ||
    pool.sessions.length > 20 ||
    pool.sessions.some(
      (session) =>
        !session ||
        typeof session.cookie !== "string" ||
        session.cookie.length > 8_192 ||
        typeof session.vaultId !== "string" ||
        session.vaultId.length < 1 ||
        session.vaultId.length > 128,
    )
  )
    throw new Error("The in-memory session pool is invalid.");
  if (
    !pool.browserSession ||
    typeof pool.browserSession.cookie !== "string" ||
    typeof pool.browserSession.vaultId !== "string" ||
    typeof pool.browserSession.passphrase !== "string"
  )
    throw new Error("The in-memory browser session is invalid.");
  return pool;
}

export function clearCapturedMessages() {
  const response = http.del(`${MAILPIT_ORIGIN}/api/v1/messages`, null, {
    tags: { name: "smtp-capture-clear" },
  });
  if (response.status < 200 || response.status >= 300) throw new Error("The local SMTP capture could not be cleared.");
}

export function waitForCapturedActionUrl(email, timeoutSeconds = 30, recordDiagnostic = () => {}) {
  const deadline = Date.now() + timeoutSeconds * 1_000;
  let listResponseRecorded = false;
  let listParsedRecorded = false;
  while (Date.now() < deadline) {
    const list = http.get(`${MAILPIT_ORIGIN}/api/v1/messages?start=0&limit=50`, {
      tags: { name: "smtp-capture-list" },
    });
    if (list.status !== 200) throw new Error("The local SMTP capture service is unavailable.");
    if (!listResponseRecorded) {
      recordDiagnostic("list_response_received");
      listResponseRecorded = true;
    }
    let payload;
    try {
      payload = JSON.parse(list.body);
    } catch {
      throw new Error("The local SMTP capture response was invalid.");
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload) || !Array.isArray(payload.messages))
      throw new Error("The local SMTP capture response was invalid.");
    if (!listParsedRecorded) {
      recordDiagnostic("list_parsed");
      listParsedRecorded = true;
    }
    const summary = payload.messages.find(
      (message) =>
        Array.isArray(message.To) && message.To.some((recipient) => recipient.Address?.toLowerCase() === email),
    );
    if (summary) {
      recordDiagnostic("message_found");
      const messageId = summary.ID ?? summary.Id ?? summary.id;
      if (typeof messageId !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(messageId))
        throw new Error("The captured message identifier was invalid.");
      recordDiagnostic("message_id_validated");
      const detail = http.get(`${MAILPIT_ORIGIN}/api/v1/message/${messageId}`, {
        tags: { name: "smtp-capture-read" },
      });
      if (detail.status !== 200) throw new Error("The captured sign-in message was unavailable.");
      recordDiagnostic("detail_received");
      let content;
      try {
        content = JSON.parse(detail.body);
      } catch {
        throw new Error("The captured sign-in message was invalid.");
      }
      if (
        !content ||
        typeof content !== "object" ||
        Array.isArray(content) ||
        (typeof content.Text !== "string" && typeof content.HTML !== "string")
      )
        throw new Error("The captured sign-in message was invalid.");
      recordDiagnostic("detail_parsed");
      const body = `${content.Text ?? ""}\n${content.HTML ?? ""}`.replaceAll("&amp;", "&");
      const match = body.match(/(https?):\/\/localhost:4000(\/auth\/confirm)#([^\s"'<>]+)/);
      if (!match) throw new Error("The captured sign-in message did not contain a local confirmation link.");
      recordDiagnostic("confirmation_link_found");
      const actionUrl = match[0];
      const actionOrigin = `${match[1]}://localhost:4000`;
      const actionPath = match[2];
      const fragment = match[3];
      recordDiagnostic("url_parsed");
      if (actionOrigin !== BASE_URL) throw new Error("The captured sign-in link did not match the run origin.");
      recordDiagnostic("origin_validated");
      if (actionPath !== "/auth/confirm")
        throw new Error("The captured sign-in link did not match the confirmation route.");
      recordDiagnostic("path_validated");
      const tokenIsPresent = fragment.split("&").some((parameter) => {
        const tokenPrefix = "token=";
        return parameter.startsWith(tokenPrefix) && parameter.slice(tokenPrefix.length).length > 0;
      });
      if (!tokenIsPresent) throw new Error("The captured sign-in link did not contain a confirmation token.");
      recordDiagnostic("token_present");
      recordDiagnostic("action_url_validated");
      clearCapturedMessages();
      recordDiagnostic("mailbox_cleared");
      return actionUrl;
    }
    sleep(0.5);
  }
  throw new Error("The local SMTP capture did not receive the expected message.");
}

export function mailpitMessageCount(email) {
  const list = http.get(`${MAILPIT_ORIGIN}/api/v1/messages?start=0&limit=50`, {
    tags: { name: "smtp-capture-list" },
  });
  if (list.status !== 200) throw new Error("The local SMTP capture service is unavailable.");
  let messages;
  try {
    messages = JSON.parse(list.body).messages;
  } catch {
    throw new Error("The local SMTP capture response was invalid.");
  }
  return Array.isArray(messages)
    ? messages.filter(
        (message) =>
          Array.isArray(message.To) && message.To.some((recipient) => recipient.Address?.toLowerCase() === email),
      ).length
    : 0;
}

export function encodedSyntheticAccountPayload() {
  const bytes = new Uint8Array(randomBytes(32));
  bytes[0] = 1;
  return b64encode(bytes);
}

export function jsonRequestOptions({ cookie, tags = {} } = {}) {
  return {
    headers: {
      "content-type": "application/json",
      origin: BASE_URL,
      ...(cookie ? { cookie } : {}),
    },
    tags,
  };
}

export function handleSummary(data) {
  const filePath = __ENV.LOADTEST_SUMMARY_PATH;
  if (typeof filePath !== "string" || !filePath.includes(`/test-results/load/${PROJECT_ID}/`))
    throw new Error("The sanitized summary destination is not run-owned.");
  return { [filePath]: JSON.stringify(sanitizeSummary(data)) };
}

export function sanitizeSummary(data) {
  const metrics = {};
  for (const [name, metric] of Object.entries(data.metrics ?? {})) {
    const values = {};
    for (const [key, value] of Object.entries(metric.values ?? {})) {
      if (typeof value === "number" && Number.isFinite(value)) values[key] = value;
    }
    if (Object.keys(values).length > 0) metrics[name] = values;
  }
  return {
    metrics,
    checks: data.root_group?.checks ?? [],
  };
}
