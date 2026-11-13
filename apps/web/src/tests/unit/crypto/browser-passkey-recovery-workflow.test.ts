import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticatePasskey: vi.fn(),
  base64ToBytes: vi.fn(),
  bytesToBase64: vi.fn(() => "c3ludGhldGljLWVuY3J5cHRlZC1wYWNrYWdl"),
  createPasskeyCredential: vi.fn(),
  createPasskeyRecoveryPackage: vi.fn(),
  loadPasskeyAuthenticationOptions: vi.fn(),
  loadPasskeyRegistrationOptions: vi.fn(),
  rewrapUserRootKey: vi.fn(),
  verifyPasskeyAuthentication: vi.fn(),
  verifyPasskeyRegistration: vi.fn(),
  wrapUserRootKeyWithVaultUnlockSecret: vi.fn(),
  passkeyRecoverySalt: vi.fn(),
  recoverUserRootKeyFromPasskeyPackage: vi.fn(),
}));

vi.mock("@/shared/infrastructure/browser-base64", () => ({
  base64ToBytes: mocks.base64ToBytes,
  bytesToBase64: mocks.bytesToBase64,
}));
vi.mock("@/modules/crypto/infrastructure/browser-passkey-recovery-client", () => ({
  loadPasskeyAuthenticationOptions: mocks.loadPasskeyAuthenticationOptions,
  loadPasskeyRegistrationOptions: mocks.loadPasskeyRegistrationOptions,
  rewrapUserRootKey: mocks.rewrapUserRootKey,
  verifyPasskeyAuthentication: mocks.verifyPasskeyAuthentication,
  verifyPasskeyRegistration: mocks.verifyPasskeyRegistration,
}));
vi.mock("@/modules/crypto/infrastructure/browser-passkey-prf", () => ({
  authenticatePasskey: mocks.authenticatePasskey,
  createPasskeyCredential: mocks.createPasskeyCredential,
}));
vi.mock("@/modules/crypto/infrastructure/browser-passkey-recovery-package", () => ({
  createPasskeyRecoveryPackage: mocks.createPasskeyRecoveryPackage,
  passkeyRecoverySalt: mocks.passkeyRecoverySalt,
  recoverUserRootKeyFromPasskeyPackage: mocks.recoverUserRootKeyFromPasskeyPackage,
}));
vi.mock("@/modules/crypto/infrastructure/browser-vault-unlock-secret-change", () => ({
  wrapUserRootKeyWithVaultUnlockSecret: mocks.wrapUserRootKeyWithVaultUnlockSecret,
}));

import { enrollPasskeyRecovery } from "@/modules/crypto/infrastructure/browser-passkey-recovery-workflow";

afterEach(() => vi.clearAllMocks());

describe("passkey recovery enrollment key cleanup", () => {
  it.each([false, true])("clears the PRF output and salt after completion (failure=%s)", async (failVerification) => {
    const prfOutput = new Uint8Array(32).fill(7);
    const prfSalt = new Uint8Array(32).fill(9);
    mocks.loadPasskeyRegistrationOptions.mockResolvedValue({});
    mocks.createPasskeyCredential.mockResolvedValue({
      registrationResponse: { response: "synthetic-registration" },
      prfOutput,
      prfSalt,
    });
    mocks.createPasskeyRecoveryPackage.mockResolvedValue(new Uint8Array([1, 2, 3]));
    mocks.verifyPasskeyRegistration.mockImplementation(async () => {
      if (failVerification) throw new Error("synthetic verification failure");
    });

    const enrollment = enrollPasskeyRecovery(new Uint8Array(32).fill(4));
    if (failVerification) await expect(enrollment).rejects.toThrow("synthetic verification failure");
    else await expect(enrollment).resolves.toBeUndefined();

    expect([...prfOutput]).toEqual(new Array(32).fill(0));
    expect([...prfSalt]).toEqual(new Array(32).fill(0));
  });
});
