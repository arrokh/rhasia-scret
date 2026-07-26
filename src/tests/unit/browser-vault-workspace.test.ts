import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createUserEncryptionIdentity: vi.fn(),
  decryptAccountConfiguration: vi.fn(),
  recoverUserRootKeyWithPasskey: vi.fn(),
  unlockPersonalVault: vi.fn(),
  unlockPersonalVaultWithUserRootKey: vi.fn(),
  unlockSharedVault: vi.fn()
}));

vi.mock("@/modules/crypto", () => ({
  createUserEncryptionIdentity: mocks.createUserEncryptionIdentity,
  recoverUserRootKeyWithPasskey: mocks.recoverUserRootKeyWithPasskey,
  serializeEncryptedEnvelope: vi.fn(),
  unlockPersonalVault: mocks.unlockPersonalVault,
  unlockPersonalVaultWithUserRootKey: mocks.unlockPersonalVaultWithUserRootKey
}));
vi.mock("@/modules/vault-membership", () => ({ unlockSharedVault: mocks.unlockSharedVault }));
vi.mock("@/modules/authenticator-account/infrastructure/browser-account-payload", () => ({
  decryptAccountConfiguration: mocks.decryptAccountConfiguration
}));

import { loadUnlockedVaultWorkspace, loadUnlockedVaultWorkspaceWithPasskey } from "@/modules/authenticator-account/infrastructure/browser-vault-workspace";

describe("loadUnlockedVaultWorkspace", () => {
  beforeEach(() => vi.resetAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("decrypts and orders accounts across personal and accessible Shared Vaults in the browser", async () => {
    const userRootKey = Uint8Array.of(1);
    const personalVaultKey = Uint8Array.of(2);
    const sharedVaultKey = Uint8Array.of(3);
    mocks.unlockPersonalVault.mockResolvedValue({ userRootKey, personalVaultKey });
    mocks.unlockSharedVault.mockResolvedValue({ vaultKey: sharedVaultKey, name: "Tim Operasional" });
    mocks.decryptAccountConfiguration
      .mockResolvedValueOnce(account("Zulu", "personal@example.test"))
      .mockResolvedValueOnce(account("Alpha", "shared@example.test"));
    const fetchMock = vi.fn(async (input: string) => {
      if (input === "/api/user-crypto-profile") return jsonResponse({
        vaultUnlockSalt: "AQ==",
        wrappedUserRootKey: "Ag==",
        encryptedPersonalVaultKey: "Aw==",
        encryptionVersion: 1,
        userEncryptionPublicKey: { kty: "EC" },
        encryptedUserPrivateKey: "BA=="
      });
      if (input === "/api/vaults/personal-1/accounts") return jsonResponse([
        { id: "personal-account", encryptedPayload: "BQ==", encryptionVersion: 1, revision: 1 }
      ]);
      if (input === "/api/shared-vaults") return jsonResponse([{
        vaultId: "shared-1",
        role: "VIEWER",
        encryptedName: "Bg==",
        encryptionVersion: 1,
        encryptedVaultKey: "Bw==",
        keyVersion: 1,
        accounts: [{ id: "shared-account", encryptedPayload: "CA==", encryptionVersion: 1, revision: 1 }]
      }]);
      throw new Error(`Unexpected request: ${input}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const workspace = await loadUnlockedVaultWorkspace("four random secret words", "personal-1");

    expect(workspace.userRootKey).toBe(userRootKey);
    expect(workspace.unavailableSharedVaults).toBe(0);
    expect(workspace.vaults).toEqual([
      expect.objectContaining({ id: "personal-1", name: "Brankas Pribadi", type: "PERSONAL", role: "OWNER", key: personalVaultKey }),
      expect.objectContaining({ id: "shared-1", name: "Tim Operasional", type: "SHARED", role: "VIEWER", key: sharedVaultKey })
    ]);
    expect(workspace.accounts.map(({ issuer, vaultName }) => ({ issuer, vaultName }))).toEqual([
      { issuer: "Alpha", vaultName: "Tim Operasional" },
      { issuer: "Zulu", vaultName: "Brankas Pribadi" }
    ]);
    expect(mocks.createUserEncryptionIdentity).not.toHaveBeenCalled();
  });

  it("loads the same workspace from a User Root Key recovered with a passkey", async () => {
    const userRootKey = Uint8Array.of(1);
    const personalVaultKey = Uint8Array.of(2);
    mocks.recoverUserRootKeyWithPasskey.mockResolvedValue(userRootKey);
    mocks.unlockPersonalVaultWithUserRootKey.mockResolvedValue(personalVaultKey);
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      if (input === "/api/user-crypto-profile") return jsonResponse({
        vaultUnlockSalt: "AQ==", wrappedUserRootKey: "Ag==", encryptedPersonalVaultKey: "Aw==", encryptionVersion: 1,
        userEncryptionPublicKey: { kty: "EC" }, encryptedUserPrivateKey: "BA=="
      });
      if (input === "/api/vaults/personal-1/accounts" || input === "/api/shared-vaults") return jsonResponse([]);
      throw new Error(`Unexpected request: ${input}`);
    }));

    const workspace = await loadUnlockedVaultWorkspaceWithPasskey("personal-1");

    expect(mocks.recoverUserRootKeyWithPasskey).toHaveBeenCalledOnce();
    expect(mocks.unlockPersonalVaultWithUserRootKey).toHaveBeenCalledWith(userRootKey, expect.objectContaining({ encryptionVersion: 1 }));
    expect(workspace.userRootKey).toBe(userRootKey);
    expect(workspace.vaults[0]?.key).toBe(personalVaultKey);
  });

  it("keeps valid accounts available when one Shared Vault cannot be decrypted", async () => {
    mocks.unlockPersonalVault.mockResolvedValue({ userRootKey: Uint8Array.of(1), personalVaultKey: Uint8Array.of(2) });
    mocks.unlockSharedVault
      .mockResolvedValueOnce({ vaultKey: Uint8Array.of(3), name: "Tim Tersedia" })
      .mockRejectedValueOnce(new Error("invalid encrypted vault"));
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      if (input === "/api/user-crypto-profile") return jsonResponse({
        vaultUnlockSalt: "AQ==", wrappedUserRootKey: "Ag==", encryptedPersonalVaultKey: "Aw==", encryptionVersion: 1,
        userEncryptionPublicKey: { kty: "EC" }, encryptedUserPrivateKey: "BA=="
      });
      if (input === "/api/vaults/personal-1/accounts") return jsonResponse([]);
      if (input === "/api/shared-vaults") return jsonResponse([
        sharedVault("shared-good", "OWNER"),
        sharedVault("shared-bad", "VIEWER")
      ]);
      throw new Error(`Unexpected request: ${input}`);
    }));

    const workspace = await loadUnlockedVaultWorkspace("four random secret words", "personal-1");

    expect(workspace.vaults.map((vault) => vault.id)).toEqual(["personal-1", "shared-good"]);
    expect(workspace.unavailableSharedVaults).toBe(1);
  });
});

function account(issuer: string, accountName: string) {
  return { issuer, accountName, secret: Uint8Array.of(9), algorithm: "SHA-1" as const, digits: 6 as const, period: 30 };
}

function sharedVault(vaultId: string, role: "OWNER" | "VIEWER") {
  return {
    vaultId,
    role,
    encryptedName: "Bg==",
    encryptionVersion: 1,
    encryptedVaultKey: "Bw==",
    keyVersion: 1,
    accounts: []
  };
}

function jsonResponse(body: unknown) {
  return { ok: true, json: async () => body };
}
