import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateApplicationMutation: vi.fn(),
  getCredential: vi.fn(),
  issueChallenge: vi.fn(),
  generateAuthenticationOptions: vi.fn()
}));

vi.mock("@/shared/infrastructure/authenticated-application-request", () => ({ authenticateApplicationMutation: mocks.authenticateApplicationMutation }));
vi.mock("@/modules/identity/server", () => ({
  createPasskeyRecoveryRepository: () => ({ getCredential: mocks.getCredential, issueChallenge: mocks.issueChallenge }),
  passkeyRecoveryConfiguration: () => ({ rpId: "localhost", origin: "http://localhost:3000", rpName: "rhasia-scret" })
}));
vi.mock("@simplewebauthn/server", () => ({ generateAuthenticationOptions: mocks.generateAuthenticationOptions }));

import { POST } from "@/app/api/passkey-recovery/authentication/options/route";

describe("POST /api/passkey-recovery/authentication/options", () => {
  afterEach(() => vi.clearAllMocks());

  it("returns opaque recovery ciphertext with a non-cacheable one-time challenge", async () => {
    mocks.authenticateApplicationMutation.mockResolvedValue({ id: "user-1" });
    mocks.getCredential.mockResolvedValue({ credentialId: Uint8Array.of(1, 2, 3), encryptedRecoveryPackage: Uint8Array.of(9, 8, 7) });
    mocks.generateAuthenticationOptions.mockResolvedValue({ challenge: "challenge", rpId: "localhost", allowCredentials: [{ id: "AQID", type: "public-key" }] });

    const response = await POST();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ challenge: "challenge", rpId: "localhost", allowCredentials: [{ id: "AQID", type: "public-key" }], encryptedRecoveryPackage: "CQgH" });
    expect(mocks.issueChallenge).toHaveBeenCalledWith("user-1", "AUTHENTICATION", "challenge");
  });
});
