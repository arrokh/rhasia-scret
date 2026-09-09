import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createPasskeyCredential: vi.fn(),
  createPasskeyRecoveryPackage: vi.fn(),
  loadPasskeyRegistrationOptions: vi.fn(),
  verifyPasskeyRegistration: vi.fn(),
}));

vi.mock("@/modules/crypto/infrastructure/browser-passkey-prf", () => ({
  createPasskeyCredential: mocks.createPasskeyCredential,
}));
vi.mock("@/modules/crypto/infrastructure/browser-passkey-recovery-package", () => ({
  createPasskeyRecoveryPackage: mocks.createPasskeyRecoveryPackage,
}));
vi.mock("@/modules/crypto/infrastructure/browser-passkey-recovery-client", () => ({
  loadPasskeyRegistrationOptions: mocks.loadPasskeyRegistrationOptions,
  verifyPasskeyRegistration: mocks.verifyPasskeyRegistration,
}));

import { enrollPasskeyRecovery } from "@/modules/crypto/infrastructure/browser-passkey-recovery-workflow";

describe("browser passkey recovery workflow", () => {
  afterEach(() => vi.clearAllMocks());

  it("clears the temporary PRF output after successful enrollment", async () => {
    const prfOutput = Uint8Array.of(1, 2, 3);
    const options = { challenge: "challenge" } as PublicKeyCredentialCreationOptionsJSON;
    mocks.loadPasskeyRegistrationOptions.mockResolvedValue(options);
    mocks.createPasskeyCredential.mockResolvedValue({
      registrationResponse: { id: "credential" },
      prfOutput,
      prfSalt: Uint8Array.of(4, 5, 6),
    });
    mocks.createPasskeyRecoveryPackage.mockResolvedValue(Uint8Array.of(7, 8, 9));
    mocks.verifyPasskeyRegistration.mockResolvedValue(undefined);

    await enrollPasskeyRecovery(Uint8Array.of(10, 11, 12));

    expect(prfOutput).toEqual(Uint8Array.of(0, 0, 0));
    expect(mocks.verifyPasskeyRegistration).toHaveBeenCalledOnce();
  });

  it("clears the temporary PRF output when enrollment fails", async () => {
    const prfOutput = Uint8Array.of(1, 2, 3);
    mocks.loadPasskeyRegistrationOptions.mockResolvedValue({ challenge: "challenge" });
    mocks.createPasskeyCredential.mockResolvedValue({
      registrationResponse: { id: "credential" },
      prfOutput,
      prfSalt: Uint8Array.of(4, 5, 6),
    });
    mocks.createPasskeyRecoveryPackage.mockRejectedValue(new Error("encryption failed"));

    await expect(enrollPasskeyRecovery(Uint8Array.of(10, 11, 12))).rejects.toThrow("encryption failed");
    expect(prfOutput).toEqual(Uint8Array.of(0, 0, 0));
  });
});
