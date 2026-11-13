import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { isDeepStrictEqual } from "node:util";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { createApiApp } from "@api/app";
import { createSmtpEmailSenders } from "@api/smtp-email-senders";
import { startRuntimeParitySMTP, type RuntimeParitySMTP } from "./runtime-parity-smtp";
import { readAndValidateDatabaseURLs } from "./runtime-parity-target";
import { runPersonalParityScenarios } from "./runtime-parity-personal";
import { runSharedParityScenarios } from "./runtime-parity-shared";
import { runSystemParityScenarios } from "./runtime-parity-system";
import { runE2EIdentityParityScenarios, runPasswordlessSessionParityScenarios } from "./runtime-parity-identity";
import type { CompareOperation, ComparedResponses, HttpScenario } from "./runtime-parity-types";
import { createPrismaClient } from "@api/shared/infrastructure/prisma-client";
import type { ApiBindings } from "@api/types";

const WEB_ORIGIN = "https://web.example.test";
const PROXY_SECRET = "runtime-parity-proxy-secret-0123456789";
const CRON_SECRET = "runtime-parity-cron-secret-0123456789";
const MAGIC_LINK_SECRET = "runtime-parity-magic-link-secret-0123456789";
const SESSION_SECRET = "runtime-parity-session-secret-0123456789";
const OWNER_ALIAS = "parity-owner";
const OWNER_SUBJECT = "parity-owner";
const OWNER_EMAIL = "parity-owner@example.test";
const OWNER_ID = "c0000000000000000000000001";
const EXTERNAL_ID = "c0000000000000000000000002";
const IDENTITY_ALIAS = "parity-identity";
const IDENTITY_SUBJECT = "parity-identity";
const IDENTITY_EMAIL = "identity@example.test";
const IDENTITY_USER_ID = "c0000000000000000000000003";
const IDENTITY_EXTERNAL_ID = "c0000000000000000000000004";
const SHARED_MEMBER_ALIAS = "parity-shared-member";
const SHARED_MEMBER_SUBJECT = "parity-shared-member";
const SHARED_MEMBER_EMAIL = "shared-member@example.test";
const SHARED_MEMBER_USER_ID = "c0000000000000000000000007";
const SHARED_MEMBER_EXTERNAL_ID = "c0000000000000000000000008";
const DELETION_ALIAS = "parity-deletion";
const DELETION_SUBJECT = "parity-deletion";
const DELETION_EMAIL = "deletion@example.test";
const DELETION_USER_ID = "c0000000000000000000000005";
const DELETION_EXTERNAL_ID = "c0000000000000000000000006";
const IMPORTED_ACCOUNT_ID = "f0992e64-52aa-4f5a-9a77-8a536e728a11";
const FIXTURE_IDS = new Set([
  OWNER_ID,
  EXTERNAL_ID,
  IDENTITY_USER_ID,
  IDENTITY_EXTERNAL_ID,
  SHARED_MEMBER_USER_ID,
  SHARED_MEMBER_EXTERNAL_ID,
  DELETION_USER_ID,
  DELETION_EXTERNAL_ID,
  IMPORTED_ACCOUNT_ID,
]);
const FIXED_TIME = new Date("2026-11-10T00:00:00.000Z");
const HEADER_NAMES = [
  "access-control-allow-origin",
  "cache-control",
  "content-disposition",
  "content-type",
  "etag",
  "retry-after",
  "vary",
  "x-request-id",
] as const;
const API_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const app = createApiApp();
const goRequestLogs = new WeakMap<ChildProcess, string[]>();
const goPanics = new WeakSet<ChildProcess>();
let activeGoProcess: ChildProcess | undefined;
let terminationRequested = false;

function handleTermination(): void {
  terminationRequested = true;
  process.exitCode = 1;
  if (activeGoProcess && activeGoProcess.exitCode === null && activeGoProcess.signalCode === null) {
    activeGoProcess.kill("SIGTERM");
  }
}

process.on("SIGINT", handleTermination);
process.on("SIGTERM", handleTermination);

const e2eUsers = JSON.stringify({
  [OWNER_ALIAS]: { subject: OWNER_SUBJECT, email: OWNER_EMAIL },
  [IDENTITY_ALIAS]: { subject: IDENTITY_SUBJECT, email: IDENTITY_EMAIL },
  [SHARED_MEMBER_ALIAS]: { subject: SHARED_MEMBER_SUBJECT, email: SHARED_MEMBER_EMAIL },
  [DELETION_ALIAS]: { subject: DELETION_SUBJECT, email: DELETION_EMAIL },
});

function createBindings(smtp: RuntimeParitySMTP, enableE2E: boolean): Omit<ApiBindings, "DATABASE_CLIENT"> {
  const smtpConfiguration = {
    NODE_ENV: "development",
    SMTP_HOST: smtp.host,
    SMTP_PORT: String(smtp.port),
    SMTP_SECURE: "false",
    SMTP_REQUIRE_TLS: "true",
    SMTP_USER: "runtime-parity-user",
    SMTP_PASSWORD: "runtime-parity-password",
    SMTP_TLS_CA: smtp.certificateAuthority,
    AUTH_EMAIL_FROM: "no-reply@example.test",
    AUTH_EMAIL_FROM_NAME: "rhasia-scret",
  };
  return {
    WEB_ORIGIN,
    PROXY_SECRET,
    CRON_SECRET,
    AUTH_BACKEND: "passwordless",
    AUTH_APP_ORIGIN: WEB_ORIGIN,
    AUTH_MAGIC_LINK_SECRET: MAGIC_LINK_SECRET,
    AUTH_SESSION_SECRET: SESSION_SECRET,
    E2E_BROWSER_TESTS: enableE2E ? "1" : "0",
    E2E_BROWSER_TEST_USERS: e2eUsers,
    PASSKEY_RP_ID: "example.test",
    PASSKEY_ORIGIN: WEB_ORIGIN,
    ...smtpConfiguration,
    EMAIL_SENDERS: createSmtpEmailSenders(smtpConfiguration),
  };
}

async function main(): Promise<void> {
  const databaseURLs = readAndValidateDatabaseURLs(process.env);
  verifyTestcontainer(databaseURLs.containerID, databaseURLs.baseURL);
  const goPool = new Pool({ connectionString: databaseURLs.go });
  const tsPool = new Pool({ connectionString: databaseURLs.ts });
  const prisma = createPrismaClient(databaseURLs.ts);
  let apiProcess: ChildProcess | undefined;
  let binaryDirectory: string | undefined;
  let smtp: RuntimeParitySMTP | undefined;

  try {
    smtp = await startRuntimeParitySMTP();
    let apiPort = await findAvailablePort();
    let goOrigin = `http://127.0.0.1:${apiPort}`;
    const goEnvironment = createGoEnvironment(databaseURLs.go, apiPort, smtp, true);
    let bindings = createBindings(smtp, true);
    await Promise.all([seedBaseline(goPool), seedBaseline(tsPool)]);
    const initialGoState = await readPublicTableSnapshot(goPool);
    const initialTsState = await readPublicTableSnapshot(tsPool);
    if (!isDeepStrictEqual(initialTsState, initialGoState)) {
      throw new Error("Runtime parity databases did not start with identical seeded state.");
    }
    if (terminationRequested) throw new Error("Runtime parity was interrupted before Go API startup.");

    binaryDirectory = await mkdtemp(join(tmpdir(), `rhasia-api-parity-${process.env.RHSIA_DISPOSABLE_RUN_ID}-`));
    const goBinary = join(binaryDirectory, "api");
    const build = spawnSync("go", ["build", "-gcflags=all=-l", "-o", goBinary, "./cmd/api"], {
      cwd: API_ROOT,
      env: goEnvironment,
      stdio: "ignore",
    });
    if (build.error || build.status !== 0) throw new Error("Could not build the real Go API for runtime parity.");
    apiProcess = spawn(goBinary, ["serve"], { cwd: API_ROOT, env: goEnvironment, stdio: ["ignore", "pipe", "pipe"] });
    captureGoRequestLogs(apiProcess);
    activeGoProcess = apiProcess;
    await waitForApi(goOrigin, apiProcess);
    if (terminationRequested) throw new Error("Runtime parity was interrupted during Go API startup.");

    let requestIndex = 0;
    const compare: CompareOperation = (scenario, goScenario = scenario) => {
      requestIndex += 1;
      return compareScenario(
        scenario,
        requestIndex,
        goOrigin,
        goPool,
        tsPool,
        prisma,
        bindings,
        goScenario,
        apiProcess,
      );
    };

    await runPersonalParityScenarios(compare);
    await runSharedParityScenarios(compare);
    await runE2EIdentityParityScenarios(compare, smtp);
    await runSystemParityScenarios(compare, CRON_SECRET);
    if (apiProcess) await stopApi(apiProcess);
    apiProcess = undefined;
    activeGoProcess = undefined;
    if (terminationRequested) throw new Error("Runtime parity was interrupted before passwordless session checks.");

    apiPort = await findAvailablePort();
    goOrigin = `http://127.0.0.1:${apiPort}`;
    const passwordlessEnvironment = createGoEnvironment(databaseURLs.go, apiPort, smtp, false);
    apiProcess = spawn(goBinary, ["serve"], {
      cwd: API_ROOT,
      env: passwordlessEnvironment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    captureGoRequestLogs(apiProcess);
    activeGoProcess = apiProcess;
    await waitForApi(goOrigin, apiProcess);
    bindings = createBindings(smtp, false);
    await runPasswordlessSessionParityScenarios(compare, smtp);

    console.info(`Go/TypeScript runtime parity passed for ${requestIndex} authorized scenarios.`);
  } finally {
    if (apiProcess) await stopApi(apiProcess);
    activeGoProcess = undefined;
    await prisma.$disconnect();
    await Promise.all([goPool.end(), tsPool.end()]);
    if (binaryDirectory) await rm(binaryDirectory, { recursive: true, force: true });
    if (smtp) await smtp.close();
    process.off("SIGINT", handleTermination);
    process.off("SIGTERM", handleTermination);
  }
}

function verifyTestcontainer(containerID: string, databaseURL: URL): void {
  const result = spawnSync("docker", ["inspect", containerID], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.error || result.status !== 0) {
    throw new Error("Runtime parity could not inspect its run-owned PostgreSQL Testcontainer.");
  }
  let inspected: Array<{
    Config?: { Image?: string; Env?: string[]; Labels?: Record<string, string> };
    State?: { Running?: boolean };
    NetworkSettings?: { Ports?: Record<string, Array<{ HostIp?: string; HostPort?: string }>> };
  }>;
  try {
    inspected = JSON.parse(result.stdout) as typeof inspected;
  } catch {
    throw new Error("Runtime parity PostgreSQL Testcontainer inspection was invalid.");
  }
  const container = inspected[0];
  const values = new Map(
    (container?.Config?.Env ?? []).map((value) => {
      const [name, ...parts] = value.split("=");
      return [name ?? "", parts.join("=")];
    }),
  );
  const mappedPort = databaseURL.port || "5432";
  const binding = container?.NetworkSettings?.Ports?.["5432/tcp"]?.find((entry) => entry.HostPort === mappedPort);
  if (
    !container?.State?.Running ||
    container.Config?.Image !== "postgres:16-alpine" ||
    container.Config.Labels?.["org.testcontainers"] !== "true" ||
    values.get("POSTGRES_DB") !== "rhasia_scret_test" ||
    values.get("POSTGRES_USER") !== "rhasia_test" ||
    values.get("POSTGRES_PASSWORD") !== "rhasia_test_password" ||
    !binding ||
    !isLoopback(binding.HostIp ?? "")
  ) {
    throw new Error("Runtime parity refused an unverified or non-synthetic PostgreSQL target.");
  }
}

function createGoEnvironment(
  databaseURL: string,
  port: number,
  smtp: RuntimeParitySMTP,
  enableE2E: boolean,
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    DATABASE_URL: databaseURL,
    PORT: String(port),
    NODE_ENV: "development",
    WEB_ORIGIN,
    PROXY_SECRET,
    CRON_SECRET,
    AUTH_BACKEND: "passwordless",
    AUTH_APP_ORIGIN: WEB_ORIGIN,
    AUTH_MAGIC_LINK_SECRET: MAGIC_LINK_SECRET,
    AUTH_SESSION_SECRET: SESSION_SECRET,
    TURNSTILE_SECRET_KEY: "",
    PASSKEY_RP_ID: "example.test",
    PASSKEY_ORIGIN: WEB_ORIGIN,
    E2E_BROWSER_TESTS: enableE2E ? "1" : "0",
    E2E_BROWSER_TEST_USERS: e2eUsers,
    SMTP_HOST: smtp.host,
    SMTP_PORT: String(smtp.port),
    SMTP_SECURE: "false",
    SMTP_REQUIRE_TLS: "true",
    SMTP_USER: "runtime-parity-user",
    SMTP_PASSWORD: "runtime-parity-password",
    SMTP_TLS_CA: smtp.certificateAuthority,
    AUTH_EMAIL_FROM: "no-reply@example.test",
    AUTH_EMAIL_FROM_NAME: "rhasia-scret",
  };
}

async function seedBaseline(pool: Pool): Promise<void> {
  await seedUser(pool, OWNER_ID, EXTERNAL_ID, OWNER_SUBJECT, OWNER_EMAIL);
  await seedUser(pool, IDENTITY_USER_ID, IDENTITY_EXTERNAL_ID, IDENTITY_SUBJECT, IDENTITY_EMAIL);
  await seedUser(pool, SHARED_MEMBER_USER_ID, SHARED_MEMBER_EXTERNAL_ID, SHARED_MEMBER_SUBJECT, SHARED_MEMBER_EMAIL);
  await seedUser(pool, DELETION_USER_ID, DELETION_EXTERNAL_ID, DELETION_SUBJECT, DELETION_EMAIL);
  await seedUserCryptoProfile(pool, IDENTITY_USER_ID, 21);
  await seedUserCryptoProfile(pool, SHARED_MEMBER_USER_ID, 23);
}

async function seedUserCryptoProfile(pool: Pool, userID: string, marker: number): Promise<void> {
  await pool.query(
    `INSERT INTO user_crypto_profiles (
       user_id, vault_unlock_salt, wrapped_user_root_key, root_key_wrapping_version,
       encrypted_personal_vault_key, personal_vault_key_encryption_version,
       user_encryption_public_key, encrypted_user_private_key, user_encryption_key_version,
       created_at, updated_at
     ) VALUES ($1, $2, $3, 1, $4, 1, NULL, NULL, NULL, $5, $5)
     ON CONFLICT (user_id) DO NOTHING`,
    [
      userID,
      Uint8Array.from({ length: 16 }, (_, index) => index + marker - 20),
      makeEnvelope(1, marker),
      makeEnvelope(1, marker + 1),
      FIXED_TIME.toISOString(),
    ],
  );
}

async function seedUser(pool: Pool, userID: string, externalID: string, subject: string, email: string): Promise<void> {
  const timestamp = FIXED_TIME.toISOString();
  await pool.query(
    `INSERT INTO application_users (id, email, status, created_at, updated_at)
     VALUES ($1, $2, 'ACTIVE', $3, $3)
     ON CONFLICT (id) DO NOTHING`,
    [userID, email, timestamp],
  );
  await pool.query(
    `INSERT INTO external_identities (
       id, application_user_id, issuer, subject, email, email_verified_at, created_at, updated_at
     ) VALUES ($1, $2, 'e2e', $3, $4, $5, $5, $5)
     ON CONFLICT (issuer, subject) DO NOTHING`,
    [externalID, userID, subject, email, timestamp],
  );
}

async function compareScenario(
  scenario: HttpScenario,
  requestIndex: number,
  goOrigin: string,
  goPool: Pool,
  tsPool: Pool,
  prisma: ReturnType<typeof createPrismaClient>,
  apiBindings: ApiBindings,
  goScenario: HttpScenario = scenario,
  goProcess?: ChildProcess,
): Promise<ComparedResponses> {
  const tsRequest = requestInit(scenario, requestIndex);
  const goRequest = requestInit(goScenario, requestIndex);
  let tsResponse: Response;
  try {
    tsResponse = await app.request(`http://api.example.test${scenario.path}`, tsRequest, {
      ...apiBindings,
      DATABASE_CLIENT: prisma,
    });
  } catch {
    throw new Error(`${scenario.name}: TypeScript request execution failed.`);
  }
  let goResponse: Response;
  try {
    goResponse = await fetch(`${goOrigin}${goScenario.path}`, goRequest);
  } catch (error) {
    const processStatus =
      goProcess?.exitCode !== null && goProcess?.exitCode !== undefined
        ? `exited with code ${goProcess.exitCode}`
        : goProcess?.signalCode
          ? `terminated by ${goProcess.signalCode}`
          : "still running";
    const cause = error instanceof Error ? error.cause : undefined;
    const causeCode =
      cause instanceof Error && "code" in cause && typeof cause.code === "string"
        ? cause.code
        : cause instanceof Error
          ? cause.name
          : "unknown";
    const recentRequests = goProcess ? (goRequestLogs.get(goProcess) ?? []).slice(-4).join(" | ") : "";
    const requestContext = recentRequests ? `; recent requests ${recentRequests}` : "";
    const panicContext = goProcess && goPanics.has(goProcess) ? "; Go panic detected" : "";
    throw new Error(
      `${scenario.name}: Go API transport failed (process ${processStatus}; network ${causeCode}${requestContext}${panicContext}).`,
    );
  }
  if (tsResponse.status !== scenario.expectedStatus || goResponse.status !== goScenario.expectedStatus) {
    throw new Error(
      `${scenario.name}: unexpected status (TypeScript ${tsResponse.status}, Go ${goResponse.status}; expected ${scenario.expectedStatus}/${goScenario.expectedStatus}).`,
    );
  }
  if (tsResponse.status !== goResponse.status) {
    throw new Error(`${scenario.name}: status mismatch (${tsResponse.status} vs ${goResponse.status}).`);
  }

  const tsBodyText = await tsResponse.text();
  const goBodyText = await goResponse.text();
  const tsBody = parseBody(tsBodyText);
  const goBody = parseBody(goBodyText);
  const normalizedTsBody = normalizeBody(tsBodyText);
  const normalizedGoBody = normalizeBody(goBodyText);
  if (!isDeepStrictEqual(normalizedTsBody, normalizedGoBody)) {
    throw new Error(
      `${scenario.name}: response bodies differ at ${describeBodyDifferences(normalizedTsBody, normalizedGoBody).join(",")}.`,
    );
  }
  for (const name of HEADER_NAMES) {
    const tsValue = tsResponse.headers.get(name);
    const goValue = goResponse.headers.get(name);
    if (name === "etag" && scenario.path === "/v1/sync/offline-bundle") {
      if (!isSynchronizationETag(tsValue) || !isSynchronizationETag(goValue)) {
        throw new Error(`${scenario.name}: ETag format mismatch.`);
      }
      continue;
    }
    if (tsValue !== goValue) throw new Error(`${scenario.name}: ${name} header mismatch.`);
  }
  const tsCookies = normalizeCookies(tsResponse.headers);
  const goCookies = normalizeCookies(goResponse.headers);
  if (!isDeepStrictEqual(tsCookies, goCookies)) {
    throw new Error(
      `${scenario.name}: Set-Cookie differs (TypeScript ${tsCookies.join(",") || "<none>"}; Go ${goCookies.join(",") || "<none>"}).`,
    );
  }

  const [goState, tsState] = await Promise.all([readPublicTableSnapshot(goPool), readPublicTableSnapshot(tsPool)]);
  if (!isDeepStrictEqual(tsState, goState)) {
    throw new Error(
      `${scenario.name}: persisted public database state differs (${describeStateDifference(tsState, goState)}).`,
    );
  }
  return {
    ts: { status: tsResponse.status, body: tsBody, headers: tsResponse.headers },
    go: { status: goResponse.status, body: goBody, headers: goResponse.headers },
  };
}

function requestInit(scenario: HttpScenario, requestIndex: number): RequestInit {
  const headers = new Headers({
    origin: WEB_ORIGIN,
    "x-rhasia-proxy-secret": PROXY_SECRET,
    "x-request-id": requestID(requestIndex),
    ...scenario.headers,
  });
  if (scenario.alias) {
    const suppliedCookie = headers.get("cookie");
    headers.set("cookie", [suppliedCookie, `rhsia-e2e-session=${scenario.alias}`].filter(Boolean).join("; "));
  }
  if (scenario.body !== undefined) headers.set("content-type", "application/json");
  const body = scenario.body === undefined ? undefined : JSON.stringify(scenario.body);
  return { method: scenario.method, headers, ...(body === undefined ? {} : { body }) };
}

function parseBody(body: string): unknown {
  if (!body) return "";
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return body;
  }
}

function describeStateDifference(tsState: Record<string, unknown[]>, goState: Record<string, unknown[]>): string {
  const tableNames = [...new Set([...Object.keys(tsState), ...Object.keys(goState)])].sort();
  const differences: string[] = [];
  for (const tableName of tableNames) {
    const tsRows = tsState[tableName] ?? [];
    const goRows = goState[tableName] ?? [];
    if (isDeepStrictEqual(tsRows, goRows)) continue;
    const changedColumns = new Set<string>();
    const pairedRows = Math.min(tsRows.length, goRows.length);
    for (let index = 0; index < pairedRows; index += 1) {
      const tsRow = tsRows[index];
      const goRow = goRows[index];
      if (!isRecord(tsRow) || !isRecord(goRow)) continue;
      for (const column of new Set([...Object.keys(tsRow), ...Object.keys(goRow)])) {
        if (!isDeepStrictEqual(tsRow[column], goRow[column])) changedColumns.add(column);
      }
    }
    const columnSummary = [...changedColumns].sort().join(",") || "row-order";
    differences.push(`${tableName}[${tsRows.length}/${goRows.length}]:${columnSummary}`);
  }
  return differences.join(";");
}

function describeBodyDifferences(left: unknown, right: unknown): string[] {
  const differences: string[] = [];
  const visit = (first: unknown, second: unknown, path: string): void => {
    if (differences.length >= 8 || isDeepStrictEqual(first, second)) return;
    if (Array.isArray(first) && Array.isArray(second)) {
      if (first.length !== second.length) differences.push(`${path || "$"}.length`);
      for (let index = 0; index < Math.min(first.length, second.length); index += 1) {
        visit(first[index], second[index], `${path}[${index}]`);
      }
      return;
    }
    if (isRecord(first) && isRecord(second)) {
      const keys = [...new Set([...Object.keys(first), ...Object.keys(second)])].sort();
      for (const key of keys) {
        if (!(key in first) || !(key in second)) differences.push(`${path}.${key}`);
        else visit(first[key], second[key], path ? `${path}.${key}` : key);
      }
      return;
    }
    differences.push(path || "$value");
  };
  visit(left, right, "");
  return differences;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function makeEnvelope(version: 1 | 2, marker: number): Uint8Array {
  return Uint8Array.from({ length: 64 }, (_, index) => (index === 0 ? version : (marker + index) % 256));
}

function normalizeBody(body: string): unknown {
  if (!body) return "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    return body;
  }
  return normalizeValue(parsed, "");
}

function normalizeValue(value: unknown, key: string): unknown {
  if (Array.isArray(value)) return value.map((entry) => normalizeValue(entry, key));
  if (value === null || typeof value !== "object") {
    if (typeof value !== "string") return value;
    const scopedIdentifier = key === "key" ? /^(invitation|member):(.+)$/.exec(value) : null;
    if (
      scopedIdentifier &&
      isGeneratedIdentifier(scopedIdentifier[2] ?? "") &&
      !FIXTURE_IDS.has(scopedIdentifier[2] ?? "")
    ) {
      return `${scopedIdentifier[1]}:<generated-id>`;
    }
    if (isIdentifierKey(key) && isGeneratedIdentifier(value) && !FIXTURE_IDS.has(value)) return "<generated-id>";
    if (key === "subject" && /^[0-9a-f]{32}$/i.test(value)) return "<generated-subject>";
    if (isTimeKey(key) && Number.isFinite(Date.parse(value))) {
      return "<time>";
    }
    if (isOpaqueDynamicKey(key) && value.length > 24) return `<dynamic:${value.length}>`;
    return value;
  }
  const normalized: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(value).sort(([left], [right]) => left.localeCompare(right))) {
    normalized[childKey] = normalizeValue(childValue, childKey);
  }
  return normalized;
}

function isGeneratedIdentifier(value: string): boolean {
  return /^c[a-z0-9]{24}$/.test(value) || /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value) || /^[0-9a-f]{32}$/i.test(value);
}

function isIdentifierKey(key: string): boolean {
  return /(?:^|_)id$/i.test(key) || /Id$/i.test(key);
}

function isTimeKey(key: string): boolean {
  return key === "now" || /(?:_at|_after|At|Time|Expires|Until)$/i.test(key);
}

function isOpaqueDynamicKey(key: string): boolean {
  return /(?:token|digest|verifier|challenge|signature|nonce|otp|secret|credential|family)$/i.test(key);
}

function normalizeCookies(headers: Headers): string[] {
  const getSetCookie = headers.getSetCookie;
  const values = typeof getSetCookie === "function" ? getSetCookie.call(headers) : [];
  return [
    ...new Set(
      values.map((value) => {
        const [cookie, ...attributes] = value.split(";");
        const name = cookie?.split("=", 1)[0]?.trim() ?? "";
        const stableAttributes = attributes
          .map((attribute) => attribute.trim())
          .filter((attribute) => !/^expires=/i.test(attribute))
          .map((attribute) => attribute.toLowerCase())
          .sort();
        return [name, ...stableAttributes].join(";");
      }),
    ),
  ].sort();
}

async function readPublicTableSnapshot(pool: Pool): Promise<Record<string, unknown[]>> {
  const tables = await pool.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     ORDER BY table_name`,
  );
  if (tables.rows.length === 0) return {};
  const queries = tables.rows.map(({ table_name: tableName }) => {
    const quotedName = `"${tableName.replaceAll('"', '""')}"`;
    const literalName = tableName.replaceAll("'", "''");
    return `SELECT '${literalName}'::text AS table_name,
                   COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text), '[]'::jsonb) AS rows
            FROM public.${quotedName} AS t`;
  });
  const result = await pool.query<{ table_name: string; rows: Record<string, unknown>[] }>(queries.join(" UNION ALL "));
  const snapshot: Record<string, unknown[]> = {};
  for (const { table_name: tableName, rows } of result.rows) {
    const normalizedRows = rows.map((row) => normalizeValue(row, ""));
    normalizedRows.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    snapshot[tableName] = normalizedRows;
  }
  return snapshot;
}

async function findAvailablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolvePromise());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not allocate a loopback API port.");
  await new Promise<void>((resolvePromise, reject) =>
    server.close((error) => (error ? reject(error) : resolvePromise())),
  );
  return address.port;
}

async function waitForApi(origin: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error("Go API exited before runtime parity started.");
    try {
      const response = await fetch(`${origin}/v1/health`, { signal: AbortSignal.timeout(500) });
      if (response.status === 200) return;
    } catch {
      // The listener is expected to refuse connections until Go finishes starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  throw new Error("Go API did not become ready for runtime parity within 30 seconds.");
}

async function stopApi(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolvePromise) => child.once("exit", () => resolvePromise()));
  child.kill("SIGTERM");
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const stopped = await Promise.race([
    exited.then(() => true),
    new Promise<boolean>((resolvePromise) => {
      timeout = setTimeout(() => resolvePromise(false), 10_000);
      timeout.unref();
    }),
  ]);
  if (timeout) clearTimeout(timeout);
  if (stopped) return;
  child.kill("SIGKILL");
  await exited;
}

function captureGoRequestLogs(child: ChildProcess): void {
  const recentRequests: string[] = [];
  goRequestLogs.set(child, recentRequests);
  const errors = child.stderr;
  if (errors) {
    errors.setEncoding("utf8");
    let errorBuffer = "";
    errors.on("data", (chunk: string | Buffer) => {
      errorBuffer += String(chunk);
      const lines = errorBuffer.split("\n");
      errorBuffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.includes("panic:") || line.includes("panic serving") || line.includes("fatal error:")) {
          goPanics.add(child);
        }
      }
    });
  }
  const output = child.stdout;
  if (!output) return;
  output.setEncoding("utf8");
  let buffered = "";
  output.on("data", (chunk: string | Buffer) => {
    buffered += String(chunk);
    const lines = buffered.split("\n");
    buffered = lines.pop() ?? "";
    for (const line of lines) {
      let entry: unknown;
      try {
        entry = JSON.parse(line) as unknown;
      } catch {
        continue;
      }
      if (!isRecord(entry) || typeof entry.method !== "string") continue;
      if (entry.event === "api_request_panic" && typeof entry.route === "string") {
        goPanics.add(child);
        recentRequests.push(`PANIC ${entry.method} ${entry.route || "<unmatched>"}`);
      } else if (entry.event === "api_request" && typeof entry.path === "string" && typeof entry.status === "number") {
        recentRequests.push(`${entry.method} ${entry.path} ${entry.status}`);
      } else {
        continue;
      }
      if (recentRequests.length > 8) recentRequests.shift();
    }
  });
}

function requestID(index: number): string {
  return index.toString(16).padStart(32, "0");
}

function isSynchronizationETag(value: string | null): boolean {
  return value !== null && /^"[A-Za-z0-9_-]{43}"$/.test(value);
}

function isLoopback(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Runtime parity failed.");
  process.exitCode = 1;
});
