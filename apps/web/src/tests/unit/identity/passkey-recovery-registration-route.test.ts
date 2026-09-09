import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  consumeChallenge: vi.fn(),
  saveCredential: vi.fn(),
  verifyRegistrationResponse: vi.fn(),
}));

vi.mock("@/modules/identity/application/load-application-user", () => ({
  loadApplicationUser: async () => ({ id: "user-1", email: "person@example.test", canAccessApplication: () => true }),
}));
vi.mock("@/modules/identity/infrastructure/prisma-application-user-repository", () => ({
  PrismaApplicationUserRepository: class {},
}));
vi.mock("@/modules/identity/infrastructure/supabase-session-verifier", () => ({ SupabaseSessionVerifier: class {} }));
vi.mock("@/modules/identity/infrastructure/passkey-recovery-configuration", () => ({
  passkeyRecoveryConfiguration: () => ({ rpId: "localhost", origin: "http://localhost:3000", rpName: "rhasia-scret" }),
}));
vi.mock("@/modules/identity/infrastructure/prisma-passkey-recovery-repository", () => ({
  PrismaPasskeyRecoveryRepository: class {
    consumeChallenge = mocks.consumeChallenge;
    saveCredential = mocks.saveCredential;
  },
}));
vi.mock("@simplewebauthn/server", () => ({ verifyRegistrationResponse: mocks.verifyRegistrationResponse }));

import { POST } from "@/app/api/passkey-recovery/registration/verify/route";

describe("POST /api/passkey-recovery/registration/verify", () => {
  afterEach(() => vi.clearAllMocks());

  it("accepts PRF capability reported in the WebAuthn client extension results", async () => {
    mocks.consumeChallenge.mockResolvedValue("challenge");
    mocks.verifyRegistrationResponse.mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: { id: "credential-id", publicKey: Uint8Array.of(1, 2, 3), counter: 0, transports: ["internal"] },
        authenticatorExtensionResults: undefined,
      },
    });
    mocks.saveCredential.mockResolvedValue(undefined);

    const response = await POST(
      new NextRequest("http://localhost:3000/api/passkey-recovery/registration/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          response: { id: "credential-id", clientExtensionResults: { prf: { enabled: true } } },
          encryptedRecoveryPackage: Buffer.alloc(13, 1).toString("base64"),
        }),
      }),
    );

    expect(response.status).toBe(204);
    expect(mocks.saveCredential).toHaveBeenCalledOnce();
  });
});
