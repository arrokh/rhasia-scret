import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiResponse } from "@api/http/api-request";
import { apiTestRequest, testApiBindings } from "@api/tests/support/api-request";

const mocks = vi.hoisted(() => ({
  authenticateReader: vi.fn(),
  authenticateMutation: vi.fn(),
  repo: {
    getPreview: vi.fn(),
    createOidcReauthenticationChallenge: vi.fn(),
    completeOidcReauthentication: vi.fn(),
    createPasswordlessOtpChallenge: vi.fn(),
    verifyPasswordlessOtp: vi.fn(),
  },
  sendDeletionOtpEmail: vi.fn(),
  sessionVerify: vi.fn(),
  AccountDeletionOtpLockedError: class extends Error {},
  AccountDeletionOtpInvalidError: class extends Error {},
  AccountDeletionChallengeUnavailableError: class extends Error {},
}));

vi.mock("@api/shared/infrastructure/authenticated-application-request", () => ({
  authenticateApplicationReader: mocks.authenticateReader,
  authenticateApplicationMutation: mocks.authenticateMutation,
}));
vi.mock("@api/modules/account-deletion/server", () => ({
  ACCOUNT_DELETION_OIDC_CHALLENGE_COOKIE: "rhsia-deletion-oidc-challenge",
  createAccountDeletionRepository: () => mocks.repo,
  createAccountDeletionEmailSender: () => ({ sendDeletionOtpEmail: mocks.sendDeletionOtpEmail }),
  isBrowserAccountDeletionReadRequest: () => true,
  isBrowserAccountDeletionRequest: () => true,
  noStoreHeaders: () => ({ "cache-control": "no-store" }),
  setDeletionAuthorizationCookie: (
    cookies: { set: (name: string, value: string, options: Record<string, unknown>) => void },
    token: string,
  ) => {
    cookies.set("rhsia-deletion-authorization", token, { httpOnly: true, maxAge: 600 });
  },
  setDeletionOidcChallengeCookie: (
    cookies: { set: (name: string, value: string, options: Record<string, unknown>) => void },
    challengeId: string,
  ) => {
    cookies.set("rhsia-deletion-oidc-challenge", challengeId, { httpOnly: true, maxAge: 600 });
  },
  AccountDeletionOtpLockedError: mocks.AccountDeletionOtpLockedError,
  AccountDeletionOtpInvalidError: mocks.AccountDeletionOtpInvalidError,
  AccountDeletionChallengeUnavailableError: mocks.AccountDeletionChallengeUnavailableError,
}));
vi.mock("@api/modules/identity/server", () => ({ authBackend: () => "oidc" }));

import { GET as preview } from "@api/route-handlers/me/deletion/preview/route";
import { createStartOidcDeletionReauthenticationHandler } from "@api/route-handlers/me/deletion/oidc/start/route";
import { POST as completeOidc } from "@api/route-handlers/me/deletion/oidc/complete/route";
import { createRequestDeletionOtpHandler } from "@api/route-handlers/me/deletion/otp/request/route";
import { createVerifyDeletionOtpHandler } from "@api/route-handlers/me/deletion/otp/verify/route";

const user = { id: "user-1", email: "person@example.test" };
const request = (path: string, init: RequestInit = {}, context: Record<string, unknown> = {}) =>
  apiTestRequest(path, init, context as never);

beforeEach(() => {
  mocks.authenticateReader.mockResolvedValue(user);
  mocks.authenticateMutation.mockResolvedValue(user);
  mocks.sessionVerify.mockResolvedValue({ issuer: "issuer", subject: "subject", email: user.email });
});

afterEach(() => vi.clearAllMocks());

describe("account deletion API routes", () => {
  it("returns only the deletion preview metadata", async () => {
    mocks.repo.getPreview.mockResolvedValue({
      passkeyRecoveryEnrolled: false,
      activeOwnedSharedVaults: 1,
      activeOwnedSharedVaultIds: ["vault-1"],
    });
    const response = await preview(request("/v1/me/deletion/preview"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      passkeyRecoveryEnrolled: false,
      activeOwnedSharedVaults: 1,
      activeOwnedSharedVaultIds: ["vault-1"],
    });
  });

  it("issues an OIDC reauthentication challenge only for same-origin browser requests", async () => {
    mocks.repo.createOidcReauthenticationChallenge.mockResolvedValue("challenge-1");
    const authenticate = mocks.authenticateMutation;
    const handler = createStartOidcDeletionReauthenticationHandler({
      authenticate,
      backend: () => "oidc",
      repository: mocks.repo,
    });
    const response = await handler(request("/v1/me/deletion/oidc/start", { method: "POST" }));
    expect(response.status).toBe(204);
    expect(response.cookies.getAll().some((cookie) => cookie.startsWith("rhsia-deletion-oidc-challenge="))).toBe(true);
    expect(mocks.repo.createOidcReauthenticationChallenge).toHaveBeenCalledWith("user-1", expect.any(Date));
  });

  it("consumes the OIDC challenge and issues a short-lived deletion authorization cookie", async () => {
    mocks.repo.completeOidcReauthentication.mockResolvedValue({ authorizationToken: "authorization-token" });
    const response = await completeOidc(
      request(
        "/v1/me/deletion/oidc/complete",
        { method: "POST", headers: { cookie: "rhsia-deletion-oidc-challenge=challenge-1" } },
        {
          bindings: { ...testApiBindings, AUTH_BACKEND: "oidc" },
          sessionVerifier: { verify: mocks.sessionVerify },
        },
      ),
    );
    expect(response.status).toBe(204);
    expect(response.cookies.getAll().some((cookie) => cookie.includes("authorization-token"))).toBe(true);
    expect(mocks.repo.completeOidcReauthentication).toHaveBeenCalledWith(
      "challenge-1",
      "issuer",
      "subject",
      expect.any(Date),
    );
  });

  it("issues passwordless OTPs without returning or logging the OTP", async () => {
    mocks.repo.createPasswordlessOtpChallenge.mockResolvedValue({ otp: "123456" });
    const handler = createRequestDeletionOtpHandler({
      authenticate: mocks.authenticateMutation,
      backend: () => "passwordless",
      repository: mocks.repo,
      sender: { sendDeletionOtpEmail: mocks.sendDeletionOtpEmail },
    });
    const response = await handler(request("/v1/me/deletion/otp/request", { method: "POST" }));
    expect(response.status).toBe(204);
    expect(mocks.sendDeletionOtpEmail).toHaveBeenCalledWith({ recipientEmail: user.email, otp: "123456" });
    expect(response.headers.get("content-type")).toBeNull();
  });

  it("verifies an OTP into a short-lived authorization cookie and maps locked/invalid attempts", async () => {
    mocks.repo.verifyPasswordlessOtp.mockResolvedValue({ authorizationToken: "authorization-token" });
    const handler = createVerifyDeletionOtpHandler({
      authenticate: mocks.authenticateMutation,
      repository: mocks.repo,
    });
    const response = await handler(
      request("/v1/me/deletion/otp/verify", { method: "POST", body: JSON.stringify({ otp: "123456" }) }),
    );
    expect(response.status).toBe(204);
    expect(response.cookies.getAll().some((cookie) => cookie.includes("authorization-token"))).toBe(true);

    mocks.repo.verifyPasswordlessOtp.mockRejectedValueOnce(new mocks.AccountDeletionOtpLockedError("locked"));
    const locked = await handler(
      request("/v1/me/deletion/otp/verify", { method: "POST", body: JSON.stringify({ otp: "123456" }) }),
    );
    expect(locked.status).toBe(429);
    mocks.repo.verifyPasswordlessOtp.mockRejectedValueOnce(new mocks.AccountDeletionOtpInvalidError("invalid"));
    const invalid = await handler(
      request("/v1/me/deletion/otp/verify", { method: "POST", body: JSON.stringify({ otp: "123456" }) }),
    );
    expect(invalid.status).toBe(400);
  });

  it("does not run deletion handlers after authentication failure", async () => {
    mocks.authenticateMutation.mockResolvedValue(ApiResponse.json({ error: "unauthenticated" }, { status: 401 }));
    const handler = createRequestDeletionOtpHandler({
      authenticate: mocks.authenticateMutation,
      backend: () => "passwordless",
      repository: mocks.repo,
      sender: { sendDeletionOtpEmail: mocks.sendDeletionOtpEmail },
    });
    expect((await handler(request("/v1/me/deletion/otp/request", { method: "POST" }))).status).toBe(401);
    expect(mocks.repo.createPasswordlessOtpChallenge).not.toHaveBeenCalled();
  });
});
