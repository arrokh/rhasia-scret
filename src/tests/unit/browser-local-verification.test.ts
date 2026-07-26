/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createPackage: vi.fn(),
  evaluatePrf: vi.fn(),
  passkeySalt: vi.fn(),
  listProfiles: vi.fn(),
  readRemembered: vi.fn(),
  recoverPackage: vi.fn(),
  removeRemembered: vi.fn(),
  saveRemembered: vi.fn()
}));

vi.mock("@/modules/sync/infrastructure/browser-offline-vault-repository", () => ({
  BrowserOfflineVaultRepository: class {
    listProfiles = mocks.listProfiles;
    readRememberedBrowser = mocks.readRemembered;
    removeRememberedBrowser = mocks.removeRemembered;
    saveRememberedBrowser = mocks.saveRemembered;
  }
}));
vi.mock("@/modules/crypto/infrastructure/browser-passkey-prf", () => ({ evaluatePasskeyPrf: mocks.evaluatePrf }));
vi.mock("@/modules/crypto/infrastructure/browser-passkey-recovery-package", () => ({
  createPasskeyRecoveryPackage: mocks.createPackage,
  passkeyRecoverySalt: mocks.passkeySalt,
  recoverUserRootKeyFromPasskeyPackage: mocks.recoverPackage
}));

import { enrollRememberedBrowser, forgetRememberedBrowser, hasRememberedBrowserForPersonalVault, recoverUserRootKeyWithRememberedBrowser } from "@/modules/crypto/infrastructure/browser-local-verification";

class FakePublicKeyCredential {
  rawId = Uint8Array.of(1, 2, 3).buffer;
}

describe("Remembered Browser Local Verification", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
    vi.stubGlobal("PublicKeyCredential", FakePublicKeyCredential);
    Object.defineProperty(window, "PublicKeyCredential", { configurable: true, value: FakePublicKeyCredential });
    Object.defineProperty(navigator, "credentials", { configurable: true, value: { create: vi.fn().mockResolvedValue(new FakePublicKeyCredential()) } });
  });

  it("stores only an origin-bound encrypted package after required PRF evaluation", async () => {
    const rootKey = Uint8Array.from({ length: 32 }, () => 9);
    mocks.evaluatePrf.mockResolvedValue(Uint8Array.from({ length: 32 }, () => 4));
    mocks.createPackage.mockResolvedValue(Uint8Array.from({ length: 32 }, () => 7));

    await enrollRememberedBrowser("profile_1", rootKey);

    expect(navigator.credentials.create).toHaveBeenCalledWith(expect.objectContaining({ publicKey: expect.objectContaining({ authenticatorSelection: expect.objectContaining({ userVerification: "required" }) }) }));
    expect(mocks.evaluatePrf).toHaveBeenCalledWith(Uint8Array.of(1, 2, 3), "localhost", expect.any(Uint8Array));
    expect(mocks.saveRemembered).toHaveBeenCalledWith(expect.objectContaining({
      version: 1,
      profileId: "profile_1",
      rpId: "localhost",
      origin: "http://localhost:3000",
      credentialId: "AQID"
    }));
    expect(JSON.stringify(mocks.saveRemembered.mock.calls[0]?.[0])).not.toContain(btoa(String.fromCharCode(...rootKey)));
  });

  it("fails closed on unsupported browsers and never stores local key material", async () => {
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: false });
    await expect(enrollRememberedBrowser("profile_1", Uint8Array.from({ length: 32 }, () => 9))).rejects.toThrow(/tidak tersedia/);
    expect(mocks.saveRemembered).not.toHaveBeenCalled();
  });

  it("fails closed when PRF evaluation is unavailable and never stores an assertion-only package", async () => {
    mocks.evaluatePrf.mockRejectedValue(new Error("PRF unavailable"));

    await expect(enrollRememberedBrowser("profile_1", Uint8Array.from({ length: 32 }, () => 9))).rejects.toThrow(/PRF unavailable/);
    expect(mocks.saveRemembered).not.toHaveBeenCalled();
  });

  it("aborts enrollment on lock/navigation and clears temporary PRF output without persisting", async () => {
    const controller = new AbortController();
    const output = Uint8Array.from({ length: 32 }, () => 4);
    let release: ((value: Uint8Array) => void) | undefined;
    mocks.evaluatePrf.mockReturnValue(new Promise<Uint8Array>((resolve) => { release = resolve; }));
    const enrolling = enrollRememberedBrowser("profile_1", Uint8Array.from({ length: 32 }, () => 9), controller.signal);
    await vi.waitFor(() => expect(mocks.evaluatePrf).toHaveBeenCalledOnce());
    controller.abort();
    release?.(output);
    await expect(enrolling).rejects.toThrow(/cancelled/);
    expect([...output]).toEqual(new Array(32).fill(0));
    expect(mocks.createPackage).not.toHaveBeenCalled();
    expect(mocks.saveRemembered).not.toHaveBeenCalled();
  });

  it("does not persist enrollment when the user cancels credential creation", async () => {
    Object.defineProperty(navigator, "credentials", { configurable: true, value: { create: vi.fn().mockResolvedValue(null) } });
    await expect(enrollRememberedBrowser("profile_1", Uint8Array.from({ length: 32 }, () => 9))).rejects.toThrow(/dibatalkan/);
    expect(mocks.evaluatePrf).not.toHaveBeenCalled();
    expect(mocks.saveRemembered).not.toHaveBeenCalled();
  });

  it("validates profile origin and RP binding before PRF-gated User Root Key recovery", async () => {
    const packageBytes = Uint8Array.from({ length: 32 }, () => 5);
    const rememberedPackage = { version: 1, profileId: "profile_1", rpId: "localhost", origin: "http://localhost:3000", credentialId: "AQID", encryptedUserRootKeyPackage: btoa(String.fromCharCode(...packageBytes)), enrolledAt: "2026-01-01T00:00:00.000Z" };
    mocks.readRemembered.mockResolvedValue(rememberedPackage);
    mocks.passkeySalt.mockReturnValue(Uint8Array.from({ length: 32 }, () => 6));
    mocks.evaluatePrf.mockResolvedValue(Uint8Array.from({ length: 32 }, () => 7));
    mocks.recoverPackage.mockResolvedValue({ userRootKey: Uint8Array.of(8), prfSalt: Uint8Array.of(6) });

    await expect(recoverUserRootKeyWithRememberedBrowser("profile_1")).resolves.toEqual(Uint8Array.of(8));
    expect(mocks.evaluatePrf).toHaveBeenCalledWith(Uint8Array.of(1, 2, 3), "localhost", expect.any(Uint8Array));

    mocks.readRemembered.mockResolvedValue({ ...rememberedPackage, origin: "https://attacker.example" });
    await expect(recoverUserRootKeyWithRememberedBrowser("profile_1")).rejects.toThrow(/tidak berlaku/);
  });

  it("cannot recover from a copied credential identifier or record without successful verification", async () => {
    const packageBytes = Uint8Array.from({ length: 32 }, () => 5);
    mocks.readRemembered.mockResolvedValue({ version: 1, profileId: "profile_1", rpId: "localhost", origin: "http://localhost:3000", credentialId: "AQID", encryptedUserRootKeyPackage: btoa(String.fromCharCode(...packageBytes)), enrolledAt: "2026-01-01T00:00:00.000Z" });
    mocks.passkeySalt.mockReturnValue(Uint8Array.from({ length: 32 }, () => 6));
    mocks.evaluatePrf.mockRejectedValue(new Error("invalid credential"));

    await expect(recoverUserRootKeyWithRememberedBrowser("profile_1")).rejects.toThrow(/invalid credential/);
    expect(mocks.recoverPackage).not.toHaveBeenCalled();
  });

  it("removes the profile-bound package explicitly", async () => {
    await forgetRememberedBrowser("profile_1");
    expect(mocks.removeRemembered).toHaveBeenCalledWith("profile_1");
  });

  it("offers remembered unlock only for a same-site package bound to the requested Personal Vault", async () => {
    mocks.listProfiles.mockResolvedValue([{ profileId: "profile_1", personalVaultId: "vault_1", synchronizedAt: "2026-01-01T00:00:00.000Z", sharedVaultCount: 0 }]);
    mocks.readRemembered.mockResolvedValue({ version: 1, profileId: "profile_1", rpId: "localhost", origin: "http://localhost:3000", credentialId: "AQID", encryptedUserRootKeyPackage: "AQID", enrolledAt: "2026-01-01T00:00:00.000Z" });
    await expect(hasRememberedBrowserForPersonalVault("vault_1")).resolves.toBe(true);
    await expect(hasRememberedBrowserForPersonalVault("other_vault")).resolves.toBe(false);
  });
});
