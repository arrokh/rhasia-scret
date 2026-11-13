import { Buffer } from "node:buffer";
import type { CompareOperation, ComparedResponses } from "./runtime-parity-types";
import type { RuntimeParitySMTP } from "./runtime-parity-smtp";
import {
  assertDeletionEmailsMatch,
  assertMagicLinkEmailsMatch,
  extractDeletionOTP,
  extractMagicLinkToken,
} from "./runtime-parity-email";

const IDENTITY_ALIAS = "parity-identity";
const DELETION_ALIAS = "parity-deletion";
const WEB_EMAIL = "magic-link@example.test";
const PWA_EMAIL = "pwa-parity@example.test";
const HANDOFF_ID = "parity-handoff-identifier-000001";
const HANDOFF_VERIFIER = "V".repeat(43);
const PASSKEY_RECOVERY_PACKAGE = Buffer.from(Array.from({ length: 64 }, (_, index) => (index + 1) % 256)).toString(
  "base64",
);
const PASSKEY_CREDENTIAL_ID = Buffer.from([17, 23, 29, 31, 37, 41, 43, 47]).toString("base64url");

export async function runPasswordlessSessionParityScenarios(
  compare: CompareOperation,
  smtp: RuntimeParitySMTP,
): Promise<void> {
  await runWebMagicLinkFlow(compare, smtp);
  await runPwaMagicLinkFlow(compare, smtp);
}

export async function runE2EIdentityParityScenarios(compare: CompareOperation, smtp: RuntimeParitySMTP): Promise<void> {
  await runPasskeyRecoveryFlow(compare);
  await runAccountDeletionFlow(compare, smtp);
}

async function runWebMagicLinkFlow(compare: CompareOperation, smtp: RuntimeParitySMTP): Promise<void> {
  const request = await requestMagicLink(compare, smtp, "web", WEB_EMAIL, "/vaults");
  const redeemed = await compare(
    {
      name: "redeem-web-magic-link",
      method: "POST",
      path: "/v1/auth/magic-link/redeem",
      expectedStatus: 200,
      body: { client: "web", token: request.tsToken },
    },
    {
      name: "redeem-web-magic-link",
      method: "POST",
      path: "/v1/auth/magic-link/redeem",
      expectedStatus: 200,
      body: { client: "web", token: request.goToken },
    },
  );
  const tsCookie = browserCookies(redeemed.ts);
  const goCookie = browserCookies(redeemed.go);
  await compare(
    {
      name: "authenticate-web-passwordless-session",
      method: "GET",
      path: "/v1/me",
      expectedStatus: 200,
      headers: { cookie: tsCookie },
    },
    {
      name: "authenticate-web-passwordless-session",
      method: "GET",
      path: "/v1/me",
      expectedStatus: 200,
      headers: { cookie: goCookie },
    },
  );
  await compare(
    {
      name: "refresh-web-passwordless-session",
      method: "POST",
      path: "/v1/auth/session/refresh",
      expectedStatus: 200,
      body: { client: "web" },
      headers: { cookie: tsCookie },
    },
    {
      name: "refresh-web-passwordless-session",
      method: "POST",
      path: "/v1/auth/session/refresh",
      expectedStatus: 200,
      body: { client: "web" },
      headers: { cookie: goCookie },
    },
  );
  await compare(
    {
      name: "revoke-web-passwordless-session",
      method: "POST",
      path: "/v1/auth/session/revoke",
      expectedStatus: 204,
      headers: { cookie: tsCookie },
    },
    {
      name: "revoke-web-passwordless-session",
      method: "POST",
      path: "/v1/auth/session/revoke",
      expectedStatus: 204,
      headers: { cookie: goCookie },
    },
  );
  await compare(
    {
      name: "reject-revoked-web-passwordless-session",
      method: "GET",
      path: "/v1/me",
      expectedStatus: 401,
      headers: { cookie: tsCookie },
    },
    {
      name: "reject-revoked-web-passwordless-session",
      method: "GET",
      path: "/v1/me",
      expectedStatus: 401,
      headers: { cookie: goCookie },
    },
  );
}

async function runPwaMagicLinkFlow(compare: CompareOperation, smtp: RuntimeParitySMTP): Promise<void> {
  await compare({
    name: "report-pending-pwa-handoff",
    method: "POST",
    path: "/v1/auth/pwa/session",
    expectedStatus: 202,
    body: { handoffId: HANDOFF_ID, verifier: HANDOFF_VERIFIER },
  });
  const request = await requestMagicLink(compare, smtp, "pwa", PWA_EMAIL, "/vaults/invitations/redeem", {
    handoffId: HANDOFF_ID,
    handoffVerifier: HANDOFF_VERIFIER,
  });
  const redeemed = await compare(
    {
      name: "redeem-pwa-magic-link",
      method: "POST",
      path: "/v1/auth/magic-link/redeem",
      expectedStatus: 200,
      body: { client: "pwa", token: request.tsToken },
    },
    {
      name: "redeem-pwa-magic-link",
      method: "POST",
      path: "/v1/auth/magic-link/redeem",
      expectedStatus: 200,
      body: { client: "pwa", token: request.goToken },
    },
  );
  const tsRefreshToken = stringField(redeemed.ts.body, "refreshToken");
  const goRefreshToken = stringField(redeemed.go.body, "refreshToken");
  await compare(
    {
      name: "publish-pwa-session-handoff",
      method: "POST",
      path: "/v1/auth/pwa/session",
      expectedStatus: 200,
      body: { handoffId: HANDOFF_ID, refreshToken: tsRefreshToken },
    },
    {
      name: "publish-pwa-session-handoff",
      method: "POST",
      path: "/v1/auth/pwa/session",
      expectedStatus: 200,
      body: { handoffId: HANDOFF_ID, refreshToken: goRefreshToken },
    },
  );
  const accepted = await compare({
    name: "redeem-pwa-session-handoff",
    method: "POST",
    path: "/v1/auth/pwa/session",
    expectedStatus: 200,
    body: { handoffId: HANDOFF_ID, verifier: HANDOFF_VERIFIER },
  });
  await compare(
    {
      name: "authenticate-pwa-passwordless-session",
      method: "GET",
      path: "/v1/me",
      expectedStatus: 200,
      headers: { cookie: browserCookies(accepted.ts) },
    },
    {
      name: "authenticate-pwa-passwordless-session",
      method: "GET",
      path: "/v1/me",
      expectedStatus: 200,
      headers: { cookie: browserCookies(accepted.go) },
    },
  );
  await compare(
    {
      name: "revoke-pwa-passwordless-session",
      method: "POST",
      path: "/v1/auth/session/revoke",
      expectedStatus: 204,
      headers: { cookie: browserCookies(accepted.ts) },
    },
    {
      name: "revoke-pwa-passwordless-session",
      method: "POST",
      path: "/v1/auth/session/revoke",
      expectedStatus: 204,
      headers: { cookie: browserCookies(accepted.go) },
    },
  );
}

async function runPasskeyRecoveryFlow(compare: CompareOperation): Promise<void> {
  await compare({
    name: "read-passkey-recovery-status-before-enrollment",
    method: "GET",
    path: "/v1/passkey-recovery/status",
    expectedStatus: 200,
    alias: IDENTITY_ALIAS,
  });
  await compare({
    name: "request-passkey-registration-options",
    method: "POST",
    path: "/v1/passkey-recovery/registration/options",
    expectedStatus: 200,
    alias: IDENTITY_ALIAS,
  });
  await compare({
    name: "verify-passkey-registration",
    method: "POST",
    path: "/v1/passkey-recovery/registration/verify",
    expectedStatus: 204,
    alias: IDENTITY_ALIAS,
    body: {
      response: {
        id: PASSKEY_CREDENTIAL_ID,
        type: "public-key",
        clientExtensionResults: { browserE2eTest: true, prf: { enabled: true } },
      },
      encryptedRecoveryPackage: PASSKEY_RECOVERY_PACKAGE,
    },
  });
  await compare({
    name: "read-passkey-recovery-status-after-enrollment",
    method: "GET",
    path: "/v1/passkey-recovery/status",
    expectedStatus: 200,
    alias: IDENTITY_ALIAS,
  });
  await compare({
    name: "request-passkey-authentication-options",
    method: "POST",
    path: "/v1/passkey-recovery/authentication/options",
    expectedStatus: 200,
    alias: IDENTITY_ALIAS,
  });
  await compare({
    name: "verify-passkey-authentication",
    method: "POST",
    path: "/v1/passkey-recovery/authentication/verify",
    expectedStatus: 200,
    alias: IDENTITY_ALIAS,
    body: {
      response: {
        id: PASSKEY_CREDENTIAL_ID,
        type: "public-key",
        clientExtensionResults: { browserE2eTest: true },
        response: {},
      },
    },
  });
  await compare({
    name: "remove-passkey-recovery-credential",
    method: "DELETE",
    path: "/v1/passkey-recovery",
    expectedStatus: 204,
    alias: IDENTITY_ALIAS,
  });
  await compare({
    name: "read-passkey-recovery-status-after-removal",
    method: "GET",
    path: "/v1/passkey-recovery/status",
    expectedStatus: 200,
    alias: IDENTITY_ALIAS,
  });
  await compare({
    name: "request-passkey-authentication-without-enrollment",
    method: "POST",
    path: "/v1/passkey-recovery/authentication/options",
    expectedStatus: 404,
    alias: IDENTITY_ALIAS,
  });
}

async function runAccountDeletionFlow(compare: CompareOperation, smtp: RuntimeParitySMTP): Promise<void> {
  await compare({
    name: "read-account-deletion-preview",
    method: "GET",
    path: "/v1/me/deletion/preview",
    expectedStatus: 200,
    alias: DELETION_ALIAS,
  });
  await compare({
    name: "request-account-deletion-otp",
    method: "POST",
    path: "/v1/me/deletion/otp/request",
    expectedStatus: 204,
    alias: DELETION_ALIAS,
  });
  const tsOtpMessage = await smtp.takeMessage();
  const goOtpMessage = await smtp.takeMessage();
  assertDeletionEmailsMatch(tsOtpMessage, goOtpMessage);
  const tsOtp = extractDeletionOTP(tsOtpMessage);
  const goOtp = extractDeletionOTP(goOtpMessage);
  const tsInvalidOTP = tsOtp === "000000" ? "000001" : "000000";
  const goInvalidOTP = goOtp === "000000" ? "000001" : "000000";
  await compare(
    {
      name: "reject-invalid-account-deletion-otp",
      method: "POST",
      path: "/v1/me/deletion/otp/verify",
      expectedStatus: 400,
      alias: DELETION_ALIAS,
      body: { otp: tsInvalidOTP },
    },
    {
      name: "reject-invalid-account-deletion-otp",
      method: "POST",
      path: "/v1/me/deletion/otp/verify",
      expectedStatus: 400,
      alias: DELETION_ALIAS,
      body: { otp: goInvalidOTP },
    },
  );
  const verified = await compare(
    {
      name: "verify-account-deletion-otp",
      method: "POST",
      path: "/v1/me/deletion/otp/verify",
      expectedStatus: 204,
      alias: DELETION_ALIAS,
      body: { otp: tsOtp },
    },
    {
      name: "verify-account-deletion-otp",
      method: "POST",
      path: "/v1/me/deletion/otp/verify",
      expectedStatus: 204,
      alias: DELETION_ALIAS,
      body: { otp: goOtp },
    },
  );
  const tsAuthorization = cookieFromResponse(verified.ts, "rhsia-account-deletion-authorization");
  const goAuthorization = cookieFromResponse(verified.go, "rhsia-account-deletion-authorization");
  const deleted = await compare(
    {
      name: "delete-account-after-otp-reauthentication",
      method: "DELETE",
      path: "/v1/me",
      expectedStatus: 200,
      alias: DELETION_ALIAS,
      headers: { cookie: tsAuthorization },
      body: { confirmation: "HAPUS AKUN", acknowledged: true, vaultDecisions: [] },
    },
    {
      name: "delete-account-after-otp-reauthentication",
      method: "DELETE",
      path: "/v1/me",
      expectedStatus: 200,
      alias: DELETION_ALIAS,
      headers: { cookie: goAuthorization },
      body: { confirmation: "HAPUS AKUN", acknowledged: true, vaultDecisions: [] },
    },
  );
  const tsReceipt = stringField(deleted.ts.body, "receiptId");
  const goReceipt = stringField(deleted.go.body, "receiptId");
  const tsCompletion = await smtp.takeMessage();
  const goCompletion = await smtp.takeMessage();
  assertDeletionEmailsMatch(tsCompletion, goCompletion);
  if (!tsCompletion.includes(tsReceipt) || !goCompletion.includes(goReceipt)) {
    throw new Error("Account-deletion confirmation did not include the response receipt.");
  }
}

async function requestMagicLink(
  compare: CompareOperation,
  smtp: RuntimeParitySMTP,
  client: "web" | "pwa",
  email: string,
  returnPath: "/vaults" | "/vaults/invitations/redeem",
  handoff?: Readonly<{ handoffId: string; handoffVerifier: string }>,
): Promise<Readonly<{ tsToken: string; goToken: string }>> {
  const body = { client, email, returnPath, ...(handoff ?? {}) };
  await compare({
    name: `request-${client}-magic-link`,
    method: "POST",
    path: "/v1/auth/magic-link/request",
    expectedStatus: 200,
    body,
  });
  const tsMessage = await smtp.takeMessage();
  const goMessage = await smtp.takeMessage();
  assertMagicLinkEmailsMatch(tsMessage, goMessage);
  return { tsToken: extractMagicLinkToken(tsMessage), goToken: extractMagicLinkToken(goMessage) };
}

function browserCookies(response: ComparedResponses["ts"]): string {
  const values = setCookieValues(response.headers)
    .filter((value) => /^rhsia-passwordless-(?:access|refresh|assertion)=/.test(value))
    .join("; ");
  if (!values || values.split(";").length !== 3)
    throw new Error("A successful passwordless response omitted session cookies.");
  return values;
}

function cookieFromResponse(response: ComparedResponses["ts"], name: string): string {
  const value = setCookieValues(response.headers).find((cookie) => cookie.startsWith(`${name}=`));
  if (!value) throw new Error("A successful reauthentication response omitted its authorization cookie.");
  return value;
}

function setCookieValues(headers: Headers): string[] {
  const getSetCookie = headers.getSetCookie;
  const cookies = typeof getSetCookie === "function" ? getSetCookie.call(headers) : [headers.get("set-cookie") ?? ""];
  return cookies.map((cookie) => cookie.split(";", 1)[0]?.trim() ?? "").filter(Boolean);
}

function stringField(value: unknown, field: string): string {
  if (!isRecord(value) || typeof value[field] !== "string") {
    throw new Error("A runtime parity response is missing required synthetic data.");
  }
  return value[field];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
