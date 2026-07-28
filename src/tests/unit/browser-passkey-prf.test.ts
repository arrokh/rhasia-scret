/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { evaluatePasskeyPrf, PasskeyPrfUnsupportedError } from "@/modules/crypto/infrastructure/browser-passkey-prf";

class FakePublicKeyCredential {
  getClientExtensionResults() {
    return { prf: { results: { first: Uint8Array.of(7, 8, 9).buffer } } };
  }
}

describe("WebAuthn PRF evaluation", () => {
  const get = vi.fn();

  beforeEach(() => {
    get.mockReset();
    vi.stubGlobal("PublicKeyCredential", FakePublicKeyCredential);
    Object.defineProperty(window, "PublicKeyCredential", { configurable: true, value: FakePublicKeyCredential });
    Object.defineProperty(navigator, "credentials", { configurable: true, value: { get } });
  });

  it("requires user verification and releases only the authenticator PRF result", async () => {
    get.mockResolvedValue(new FakePublicKeyCredential());

    await expect(evaluatePasskeyPrf(Uint8Array.of(1, 2, 3), "localhost", Uint8Array.from({ length: 32 }, () => 4))).resolves.toEqual(Uint8Array.of(7, 8, 9));

    expect(get).toHaveBeenCalledWith({ publicKey: expect.objectContaining({
      rpId: "localhost",
      userVerification: "required",
      allowCredentials: [{ type: "public-key", id: Uint8Array.of(1, 2, 3).buffer }],
      extensions: expect.objectContaining({ prf: expect.any(Object) })
    }) });
  });

  it("fails closed on cancellation or an assertion without PRF output", async () => {
    get.mockResolvedValueOnce(null);
    await expect(evaluatePasskeyPrf(Uint8Array.of(1), "localhost", new Uint8Array(32))).rejects.toThrow(/cancelled/);
    get.mockResolvedValueOnce(Object.assign(new FakePublicKeyCredential(), { getClientExtensionResults: () => ({}) }));
    await expect(evaluatePasskeyPrf(Uint8Array.of(1), "localhost", new Uint8Array(32))).rejects.toBeInstanceOf(PasskeyPrfUnsupportedError);
  });
});
