/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ options: vi.fn(), verify: vi.fn(), decrypt: vi.fn() }));
vi.mock("@/modules/crypto/infrastructure/browser-passkey-recovery-client", () => ({
  loadPasskeyAuthenticationOptions: mocks.options,
  verifyPasskeyAuthentication: mocks.verify,
}));
vi.mock("@/modules/crypto/infrastructure/browser-passkey-recovery-package", () => ({
  passkeyRecoverySalt: () => new Uint8Array(32).fill(4),
  recoverUserRootKeyFromPasskeyPackage: mocks.decrypt,
}));
import { recoverUserRootKeyWithPasskey } from "@/modules/crypto/infrastructure/browser-passkey-recovery-workflow";

class Assertion {
  authenticatorData = new ArrayBuffer(32);
  clientDataJSON = new ArrayBuffer(32);
  signature = new ArrayBuffer(32);
  userHandle = null;
}
class Credential {
  id = "AQI";
  rawId = Uint8Array.of(1, 2).buffer;
  type = "public-key";
  response = new Assertion();
  output = new Uint8Array(32).fill(7);
  getClientExtensionResults() {
    return { prf: { results: { first: this.output.buffer } } };
  }
}

describe("passkey unlock ceremony", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  it.each([false, true])(
    "uses one verified PRF assertion and clears output (verification fails: %s)",
    async (fails) => {
      const credential = new Credential();
      const get = vi.fn().mockResolvedValue(credential);
      vi.stubGlobal("navigator", { credentials: { get } });
      vi.stubGlobal("PublicKeyCredential", Credential);
      vi.stubGlobal("AuthenticatorAssertionResponse", Assertion);
      mocks.options.mockResolvedValue({
        challenge: "AQID",
        rpId: "example.test",
        userVerification: "required",
        allowCredentials: [{ id: "AQI", type: "public-key" }],
        encryptedRecoveryPackage: "CQ==",
      });
      mocks.verify.mockImplementation(async (response: unknown) => {
        void response;
        expect(mocks.decrypt).not.toHaveBeenCalled();
        if (fails) throw new Error("verification failed");
        return { encryptedRecoveryPackage: "CQ==" };
      });
      mocks.decrypt.mockResolvedValue({ userRootKey: new Uint8Array(32).fill(8) });
      if (fails) await expect(recoverUserRootKeyWithPasskey()).rejects.toThrow("verification failed");
      else await expect(recoverUserRootKeyWithPasskey()).resolves.toEqual(new Uint8Array(32).fill(8));
      expect(get).toHaveBeenCalledOnce();
      expect(JSON.stringify(mocks.verify.mock.calls[0])).not.toContain('"prf"');
      expect(get).toHaveBeenCalledWith({
        publicKey: expect.objectContaining({
          challenge: Uint8Array.of(1, 2, 3),
          userVerification: "required",
          extensions: { prf: { eval: { first: new Uint8Array(32).fill(4).buffer } } },
        }),
      });
      expect(credential.output).toEqual(new Uint8Array(32));
      expect(mocks.decrypt).toHaveBeenCalledTimes(fails ? 0 : 1);
    },
  );
});
