/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const mocks = vi.hoisted(() => ({
  generateVaultUnlockSecret: vi.fn(() => "alpha bravo charlie delta echo foxtrot"),
  authenticatePasskey: vi.fn(async () => ({ id: "credential-response" })),
  evaluatePasskeyPrf: vi.fn(async () => Uint8Array.of(3, 4)),
  passkeyRecoverySalt: vi.fn(() => Uint8Array.of(5, 6)),
  recoverUserRootKeyFromPasskeyPackage: vi.fn(async () => ({ userRootKey: Uint8Array.of(7, 8), prfSalt: Uint8Array.of(5, 6) })),
  wrapUserRootKeyWithVaultUnlockSecret: vi.fn(async () => ({ vaultUnlockSalt: new Uint8Array(16), wrappedUserRootKey: new Uint8Array(13) }))
}));

vi.mock("@/modules/crypto/presentation/generate-vault-unlock-secret", () => ({ generateVaultUnlockSecret: mocks.generateVaultUnlockSecret }));
vi.mock("@/modules/crypto/infrastructure/browser-passkey-prf", () => ({
  authenticatePasskey: mocks.authenticatePasskey,
  evaluatePasskeyPrf: mocks.evaluatePasskeyPrf
}));
vi.mock("@/modules/crypto/infrastructure/browser-passkey-recovery-package", () => ({
  passkeyRecoverySalt: mocks.passkeyRecoverySalt,
  recoverUserRootKeyFromPasskeyPackage: mocks.recoverUserRootKeyFromPasskeyPackage
}));
vi.mock("@/modules/crypto/infrastructure/browser-vault-unlock-secret-change", () => ({
  wrapUserRootKeyWithVaultUnlockSecret: mocks.wrapUserRootKeyWithVaultUnlockSecret
}));

import { PasskeyRecoveryReset } from "@/modules/crypto/presentation/passkey-recovery-reset";

describe("PasskeyRecoveryReset", () => {
  let root: Root | undefined;

  afterEach(async () => {
    await act(async () => root?.unmount());
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("verifies the passkey, recovers the User Root Key locally, and persists only rewrapped material", async () => {
    const options = {
      challenge: "challenge",
      rpId: "example.test",
      allowCredentials: [{ id: "AQI", type: "public-key" }]
    } as PublicKeyCredentialRequestOptionsJSON;
    const fetchMock = vi.fn(async (input: string, _init?: RequestInit) => {
      if (input === "/api/passkey-recovery/authentication/options") return jsonResponse(options);
      if (input === "/api/passkey-recovery/authentication/verify") return jsonResponse({ encryptedRecoveryPackage: "CQ==" });
      if (input === "/api/user-crypto-profile/rewrap") return { ok: true };
      throw new Error(`Unexpected request: ${input}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const container = document.createElement("div");
    root = createRoot(container);

    await act(async () => root?.render(createElement(PasskeyRecoveryReset)));
    await act(async () => {
      setInputValue(container.querySelector("#recovery-secret-confirmation"), "alpha bravo charlie delta echo foxtrot");
      container.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click();
    });
    await act(async () => container.querySelector<HTMLFormElement>("form")?.requestSubmit());

    expect(mocks.authenticatePasskey).toHaveBeenCalledWith(options);
    expect(mocks.evaluatePasskeyPrf).toHaveBeenCalledWith(Uint8Array.of(1, 2), "example.test", Uint8Array.of(5, 6));
    expect(mocks.recoverUserRootKeyFromPasskeyPackage).toHaveBeenCalledWith(expect.any(Uint8Array), Uint8Array.of(9));
    expect(mocks.wrapUserRootKeyWithVaultUnlockSecret).toHaveBeenCalledWith(expect.any(Uint8Array), "alpha bravo charlie delta echo foxtrot");
    const rewrapCall = fetchMock.mock.calls.find(([url]) => url === "/api/user-crypto-profile/rewrap");
    const rewrapRequest = rewrapCall?.[1];
    expect(rewrapRequest).toEqual(expect.objectContaining({ method: "POST" }));
    expect(JSON.parse(String(rewrapRequest?.body))).toEqual({
      vaultUnlockSalt: "AAAAAAAAAAAAAAAAAAAAAA==",
      wrappedUserRootKey: "AAAAAAAAAAAAAAAAAA==",
      encryptionVersion: 1
    });
    expect(container.textContent).toContain("Passphrase berhasil diatur ulang");
  });

  it("does not request recovery when the confirmation does not match", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const container = document.createElement("div");
    root = createRoot(container);

    await act(async () => root?.render(createElement(PasskeyRecoveryReset)));
    await act(async () => {
      setInputValue(container.querySelector("#recovery-secret-confirmation"), "wrong confirmation words here");
      container.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click();
    });
    await act(async () => container.querySelector<HTMLFormElement>("form")?.requestSubmit());

    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Konfirmasi harus cocok");
  });
});

function jsonResponse(value: unknown) {
  return { ok: true, json: async () => value };
}

function setInputValue(input: HTMLInputElement | null, value: string) {
  if (!input) throw new Error("Expected input.");
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
