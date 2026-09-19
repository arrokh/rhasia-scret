import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiResponse } from "@api/http/api-request";
import { apiTestRequest } from "@api/tests/support/api-request";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  getCredential: vi.fn(),
  issueChallenge: vi.fn(),
  consumeChallenge: vi.fn(),
  saveCredential: vi.fn(),
  removeCredential: vi.fn(),
  updateCounter: vi.fn(),
  generateRegistrationOptions: vi.fn(),
  generateAuthenticationOptions: vi.fn(),
  verifyRegistrationResponse: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
}));

vi.mock("@api/shared/infrastructure/authenticated-application-request", () => ({
  authenticateApplicationMutation: mocks.authenticate,
  authenticateApplicationReader: mocks.authenticate,
}));
vi.mock("@api/modules/identity/server", () => ({
  createPasskeyRecoveryRepository: () => ({
    getCredential: mocks.getCredential,
    issueChallenge: mocks.issueChallenge,
    consumeChallenge: mocks.consumeChallenge,
    saveCredential: mocks.saveCredential,
    removeCredential: mocks.removeCredential,
    updateCounter: mocks.updateCounter,
  }),
  passkeyRecoveryConfiguration: () => ({
    rpId: "api.example.test",
    origin: "https://api.example.test",
    rpName: "rhasia-scret",
  }),
  browserE2eRegistrationCredential: () => null,
  browserE2eAuthenticationVerified: () => false,
}));
vi.mock("@simplewebauthn/server", () => ({
  generateRegistrationOptions: mocks.generateRegistrationOptions,
  generateAuthenticationOptions: mocks.generateAuthenticationOptions,
  verifyRegistrationResponse: mocks.verifyRegistrationResponse,
  verifyAuthenticationResponse: mocks.verifyAuthenticationResponse,
}));

import { DELETE } from "@api/route-handlers/passkey-recovery/route";
import { GET } from "@api/route-handlers/passkey-recovery/status/route";
import { POST as registrationOptions } from "@api/route-handlers/passkey-recovery/registration/options/route";
import { POST as registrationVerify } from "@api/route-handlers/passkey-recovery/registration/verify/route";
import { POST as authenticationOptions } from "@api/route-handlers/passkey-recovery/authentication/options/route";
import { POST as authenticationVerify } from "@api/route-handlers/passkey-recovery/authentication/verify/route";

const user = { id: "user-1", email: "person@example.test" };
const encryptedRecoveryPackage = Buffer.alloc(13, 2).toString("base64");

beforeEach(() => {
  mocks.authenticate.mockResolvedValue(user);
});

afterEach(() => vi.clearAllMocks());

describe("passkey recovery route contracts", () => {
  it("returns registration options and excludes an existing credential", async () => {
    mocks.getCredential.mockResolvedValue({ credentialId: Uint8Array.of(1, 2, 3) });
    mocks.generateRegistrationOptions.mockResolvedValue({
      challenge: "registration-challenge",
      rpID: "api.example.test",
    });

    const response = await registrationOptions(apiTestRequest("/v1/passkey-recovery/registration/options"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ challenge: "registration-challenge", rpID: "api.example.test" });
    expect(mocks.generateRegistrationOptions).toHaveBeenCalledWith(
      expect.objectContaining({ excludeCredentials: [{ id: "AQID" }], userName: user.email }),
    );
    expect(mocks.issueChallenge).toHaveBeenCalledWith("user-1", "REGISTRATION", "registration-challenge");
  });

  it("returns authentication options with ciphertext only and no-store caching", async () => {
    mocks.getCredential.mockResolvedValue({
      credentialId: Uint8Array.of(1, 2, 3),
      encryptedRecoveryPackage: Uint8Array.of(9, 8, 7),
    });
    mocks.generateAuthenticationOptions.mockResolvedValue({
      challenge: "authentication-challenge",
      rpId: "api.example.test",
      allowCredentials: [{ id: "AQID", type: "public-key" }],
    });

    const response = await authenticationOptions(apiTestRequest("/v1/passkey-recovery/authentication/options"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      challenge: "authentication-challenge",
      rpId: "api.example.test",
      allowCredentials: [{ id: "AQID", type: "public-key" }],
      encryptedRecoveryPackage: "CQgH",
    });
    expect(mocks.issueChallenge).toHaveBeenCalledWith("user-1", "AUTHENTICATION", "authentication-challenge");
  });

  it("verifies registration only after consuming the challenge and requiring PRF", async () => {
    mocks.consumeChallenge.mockResolvedValue("registration-challenge");
    mocks.verifyRegistrationResponse.mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: { id: "AQID", publicKey: Uint8Array.of(4, 5, 6), counter: 0, transports: ["internal"] },
      },
    });
    const response = await registrationVerify(
      apiTestRequest("/v1/passkey-recovery/registration/verify", {
        method: "POST",
        body: JSON.stringify({
          response: { id: "AQID", clientExtensionResults: { prf: { enabled: true } } },
          encryptedRecoveryPackage,
        }),
      }),
    );

    expect(response.status).toBe(204);
    expect(mocks.saveCredential).toHaveBeenCalledWith(
      "user-1",
      expect.anything(),
      expect.anything(),
      0n,
      ["internal"],
      expect.anything(),
    );
  });

  it("rejects registration without PRF and does not persist the credential", async () => {
    mocks.consumeChallenge.mockResolvedValue("registration-challenge");
    mocks.verifyRegistrationResponse.mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: { id: "AQID", publicKey: Uint8Array.of(4, 5, 6), counter: 0, transports: [] },
      },
    });
    const response = await registrationVerify(
      apiTestRequest("/v1/passkey-recovery/registration/verify", {
        method: "POST",
        body: JSON.stringify({ response: { id: "AQID" }, encryptedRecoveryPackage }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "passkey_prf_required" });
    expect(mocks.saveCredential).not.toHaveBeenCalled();
  });

  it("returns the recovery package only after verified authentication and advances the counter", async () => {
    mocks.consumeChallenge.mockResolvedValue("authentication-challenge");
    mocks.getCredential.mockResolvedValue({
      credentialId: Uint8Array.of(1, 2, 3),
      encryptedRecoveryPackage: Uint8Array.of(9, 8, 7),
      publicKey: Uint8Array.of(4, 5, 6),
      counter: 3n,
    });
    mocks.verifyAuthenticationResponse.mockResolvedValue({
      verified: true,
      authenticationInfo: { userVerified: true, newCounter: 4 },
    });
    const response = await authenticationVerify(
      apiTestRequest("/v1/passkey-recovery/authentication/verify", {
        method: "POST",
        body: JSON.stringify({ response: { id: "AQID" } }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ encryptedRecoveryPackage: "CQgH" });
    expect(mocks.updateCounter).toHaveBeenCalledWith("user-1", 4n);
  });

  it("reports enrollment and removes the user's credential without returning package bytes", async () => {
    mocks.getCredential.mockResolvedValue({ credentialId: Uint8Array.of(1) });
    await expect(GET(apiTestRequest("/v1/passkey-recovery/status"))).resolves.toMatchObject({ status: 200 });
    const status = await GET(apiTestRequest("/v1/passkey-recovery/status"));
    await expect(status.json()).resolves.toEqual({ enrolled: true });

    const response = await DELETE(apiTestRequest("/v1/passkey-recovery", { method: "DELETE" }));
    expect(response.status).toBe(204);
    expect(mocks.removeCredential).toHaveBeenCalledWith("user-1");
  });

  it("maps missing challenges and verification failures to bounded errors", async () => {
    mocks.consumeChallenge.mockResolvedValue(null);
    mocks.getCredential.mockResolvedValue(null);
    const expired = await authenticationVerify(
      apiTestRequest("/v1/passkey-recovery/authentication/verify", {
        method: "POST",
        body: JSON.stringify({ response: {} }),
      }),
    );
    expect(expired.status).toBe(400);
    await expect(expired.json()).resolves.toEqual({ error: "passkey_challenge_expired" });

    mocks.consumeChallenge.mockResolvedValue("challenge");
    mocks.getCredential.mockResolvedValue({
      credentialId: Uint8Array.of(1),
      encryptedRecoveryPackage: Uint8Array.of(2),
      publicKey: Uint8Array.of(3),
      counter: 0n,
    });
    mocks.verifyAuthenticationResponse.mockRejectedValue(new Error("invalid credential"));
    const failed = await authenticationVerify(
      apiTestRequest("/v1/passkey-recovery/authentication/verify", {
        method: "POST",
        body: JSON.stringify({ response: {} }),
      }),
    );
    expect(failed.status).toBe(400);
    await expect(failed.json()).resolves.toEqual({ error: "passkey_verification_failed" });
  });

  it("preserves an authentication failure before touching recovery state", async () => {
    mocks.authenticate.mockResolvedValue(ApiResponse.json({ error: "unauthenticated" }, { status: 401 }));
    const response = await authenticationOptions(apiTestRequest("/v1/passkey-recovery/authentication/options"));
    expect(response.status).toBe(401);
    expect(mocks.getCredential).not.toHaveBeenCalled();
  });
});
