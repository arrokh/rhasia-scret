/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  authenticatePasskey,
  createPasskeyCredential,
  evaluatePasskeyPrf,
  PasskeyPrfUnsupportedError,
} from "@/modules/crypto/infrastructure/browser-passkey-prf";

class FakePublicKeyCredential {
  getClientExtensionResults() {
    return { prf: { results: { first: Uint8Array.of(7, 8, 9).buffer } } };
  }
}

class FakeAttestationResponse {
  attestationObject = new ArrayBuffer(32);
  clientDataJSON = new ArrayBuffer(32);

  getTransports() {
    return ["internal"] as AuthenticatorTransport[];
  }
}

class FakeRegistrationCredential extends FakePublicKeyCredential {
  id = "AQI";
  rawId = Uint8Array.of(1, 2).buffer;
  type = "public-key";
  response = new FakeAttestationResponse();
  readonly registrationPrfOutput = Uint8Array.of(7, 8, 9);
  readonly registrationPrfOutputSecond = Uint8Array.of(4, 5, 6);

  getClientExtensionResults() {
    return {
      browserE2eTest: true,
      prf: {
        enabled: true,
        results: {
          first: this.registrationPrfOutput.buffer,
          second: this.registrationPrfOutputSecond.buffer,
        },
      },
    };
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
  readonly assertionPrfOutput = Uint8Array.from({ length: 32 }, () => 7);
  extensionResultReads = 0;

  getClientExtensionResults() {
    this.extensionResultReads += 1;
    return { browserE2eTest: true, prf: { results: { first: this.assertionPrfOutput.buffer } } };
  }
}

describe("WebAuthn PRF evaluation", () => {
  const create = vi.fn();
  const get = vi.fn();

  beforeEach(() => {
    create.mockReset();
    get.mockReset();
    vi.stubGlobal("PublicKeyCredential", FakePublicKeyCredential);
    vi.stubGlobal("AuthenticatorAttestationResponse", FakeAttestationResponse);
    vi.stubGlobal("AuthenticatorAssertionResponse", FakeAssertionResponse);
    Object.defineProperty(window, "PublicKeyCredential", { configurable: true, value: FakePublicKeyCredential });
    Object.defineProperty(window, "AuthenticatorAttestationResponse", {
      configurable: true,
      value: FakeAttestationResponse,
    });
    Object.defineProperty(navigator, "credentials", { configurable: true, value: { create, get } });
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

  it("clears the authenticator PRF result after copying it for client use", async () => {
    const authenticatorOutput = Uint8Array.of(7, 8, 9);
    class MutableOutputCredential extends FakePublicKeyCredential {
      getClientExtensionResults() {
        return { prf: { results: { first: authenticatorOutput.buffer } } };
      }
    }
    get.mockResolvedValue(new MutableOutputCredential());

    const result = await evaluatePasskeyPrf(
      Uint8Array.of(1, 2, 3),
      "localhost",
      Uint8Array.from({ length: 32 }, () => 4),
    );

    expect(result).toEqual(Uint8Array.of(7, 8, 9));
    expect(authenticatorOutput).toEqual(new Uint8Array(3));
  });

  it("keeps registration PRF output out of the server response and clears the source buffer", async () => {
    const registrationCredential = new FakeRegistrationCredential();
    create.mockResolvedValue(registrationCredential);
    get.mockResolvedValue(new FakePublicKeyCredential());

    const result = await createPasskeyCredential({
      challenge: "AQID",
      rp: { id: "localhost", name: "rhasia-scret" },
      user: { id: "AQI", name: "person@example.test", displayName: "Synthetic Person" },
      pubKeyCredParams: [],
    });

    try {
      expect(result.prfOutput).toEqual(Uint8Array.of(7, 8, 9));
      expect(result.registrationResponse).toMatchObject({
        clientExtensionResults: { browserE2eTest: true, prf: { enabled: true } },
      });
      expect(JSON.stringify(result.registrationResponse)).not.toContain('"results"');
      expect(registrationCredential.registrationPrfOutput).toEqual(new Uint8Array(3));
      expect(registrationCredential.registrationPrfOutputSecond).toEqual(new Uint8Array(3));
    } finally {
      result.prfOutput.fill(0);
      result.prfSalt.fill(0);
    }
  });

  it("combines server verification fields and PRF evaluation in one assertion", async () => {
    const credential = new FakeCombinedCredential();
    get.mockResolvedValue(credential);
    const result = await authenticatePasskey(
      { challenge: "AQID", rpId: "localhost", allowCredentials: [{ id: "AQI", type: "public-key" }] },
      Uint8Array.from({ length: 32 }, () => 4),
    );

    expect(result.prfOutput).toEqual(Uint8Array.from({ length: 32 }, () => 7));
    expect(credential.assertionPrfOutput).toEqual(new Uint8Array(32));
    expect(credential.extensionResultReads).toBe(1);
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
