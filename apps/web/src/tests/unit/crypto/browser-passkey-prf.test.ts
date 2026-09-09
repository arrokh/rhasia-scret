/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  authenticatePasskey,
  evaluatePasskeyPrf,
  PasskeyPrfUnsupportedError,
} from "@/modules/crypto/infrastructure/browser-passkey-prf";

class FakePublicKeyCredential {
  getClientExtensionResults() {
    return { prf: { results: { first: Uint8Array.of(7, 8, 9).buffer } } };
  }
}

class FakeAssertionResponse {
  authenticatorData = new ArrayBuffer(32);
  clientDataJSON = new ArrayBuffer(32);
  signature = new ArrayBuffer(32);
  userHandle = null;
}

class FakeCombinedCredential extends FakePublicKeyCredential {
  id = "AQI";
  rawId = Uint8Array.of(1, 2).buffer;
  type = "public-key";
  response = new FakeAssertionResponse();
  getClientExtensionResults() {
    return { browserE2eTest: true, prf: { results: { first: Uint8Array.from({ length: 32 }, () => 7).buffer } } };
  }
}

describe("WebAuthn PRF evaluation", () => {
  const get = vi.fn();

  beforeEach(() => {
    get.mockReset();
    vi.stubGlobal("PublicKeyCredential", FakePublicKeyCredential);
    vi.stubGlobal("AuthenticatorAssertionResponse", FakeAssertionResponse);
    Object.defineProperty(window, "PublicKeyCredential", { configurable: true, value: FakePublicKeyCredential });
    Object.defineProperty(navigator, "credentials", { configurable: true, value: { get } });
  });

  it("requires user verification and releases only the authenticator PRF result", async () => {
    get.mockResolvedValue(new FakePublicKeyCredential());

    await expect(
      evaluatePasskeyPrf(
        Uint8Array.of(1, 2, 3),
        "localhost",
        Uint8Array.from({ length: 32 }, () => 4),
      ),
    ).resolves.toEqual(Uint8Array.of(7, 8, 9));

    expect(get).toHaveBeenCalledWith({
      publicKey: expect.objectContaining({
        rpId: "localhost",
        userVerification: "required",
        allowCredentials: [{ type: "public-key", id: Uint8Array.of(1, 2, 3).buffer }],
        extensions: expect.objectContaining({ prf: expect.any(Object) }),
      }),
    });
  });

  it("combines server verification fields and PRF evaluation in one assertion", async () => {
    get.mockResolvedValue(new FakeCombinedCredential());
    const result = await authenticatePasskey(
      { challenge: "AQID", rpId: "localhost", allowCredentials: [{ id: "AQI", type: "public-key" }] },
      Uint8Array.from({ length: 32 }, () => 4),
    );

    expect(result.prfOutput).toEqual(Uint8Array.from({ length: 32 }, () => 7));
    expect(result.response).toMatchObject({ id: "AQI", clientExtensionResults: { browserE2eTest: true } });
    expect(JSON.stringify(result.response)).not.toContain("prf");
    expect(get).toHaveBeenCalledOnce();
    expect(get.mock.calls[0]?.[0].publicKey).toMatchObject({
      userVerification: "required",
      extensions: { prf: { eval: { first: expect.any(ArrayBuffer) } } },
    });
  });

  it("fails closed on cancellation or an assertion without PRF output", async () => {
    get.mockResolvedValueOnce(null);
    await expect(evaluatePasskeyPrf(Uint8Array.of(1), "localhost", new Uint8Array(32))).rejects.toThrow(/cancelled/);
    get.mockResolvedValueOnce(Object.assign(new FakePublicKeyCredential(), { getClientExtensionResults: () => ({}) }));
    await expect(evaluatePasskeyPrf(Uint8Array.of(1), "localhost", new Uint8Array(32))).rejects.toBeInstanceOf(
      PasskeyPrfUnsupportedError,
    );
  });
});
