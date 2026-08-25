import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  decryptAccountConfiguration: vi.fn(),
  decryptPayloadWithContext: vi.fn(),
  fetchAuthorizedOfflineBundle: vi.fn(),
  read: vi.fn(),
  readByPersonalVaultId: vi.fn(),
  recoverUserRootKeyWithPasskey: vi.fn(),
  recoverUserRootKeyWithRememberedBrowser: vi.fn(),
  rewrapUserCryptoProfile: vi.fn(),
  replace: vi.fn(),
  unlockPersonalVault: vi.fn(),
  unlockPersonalVaultWithUserRootKey: vi.fn(),
  unlockSharedVault: vi.fn()
}));

vi.mock("@/modules/crypto", () => ({
  decryptPayloadWithContext: mocks.decryptPayloadWithContext,
  deserializeEncryptedEnvelope: vi.fn((value) => value),
  recoverUserRootKeyWithPasskey: mocks.recoverUserRootKeyWithPasskey,
  recoverUserRootKeyWithRememberedBrowser: mocks.recoverUserRootKeyWithRememberedBrowser,
  rewrapUserCryptoProfile: mocks.rewrapUserCryptoProfile,
  unlockPersonalVault: mocks.unlockPersonalVault,
  unlockPersonalVaultWithUserRootKey: mocks.unlockPersonalVaultWithUserRootKey
}));
vi.mock("@/modules/sync", () => ({
  BrowserOfflineVaultRepository: class {
    read = mocks.read;
    readByPersonalVaultId = mocks.readByPersonalVaultId;
    replace = mocks.replace;
  },
  fetchAuthorizedOfflineBundle: mocks.fetchAuthorizedOfflineBundle
}));
vi.mock("@/modules/vault-membership", () => ({ unlockSharedVault: mocks.unlockSharedVault }));
vi.mock("@/modules/authenticator-account/infrastructure/browser-account-payload", () => ({
  decryptAccountConfiguration: mocks.decryptAccountConfiguration
}));

import {
  clearUnlockedVaultWorkspace,
  loadOfflineVaultWorkspace,
  loadOfflineVaultWorkspaceWithRememberedBrowser,
  loadUnlockedVaultWorkspace,
  loadUnlockedVaultWorkspaceWithPasskey,
  loadUnlockedVaultWorkspaceWithRememberedBrowser,
  refreshUnlockedVaultWorkspace
} from "@/modules/sync/infrastructure/browser-vault-workspace";

describe("Vault workspace loading", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("navigator", { onLine: false });
    mocks.decryptPayloadWithContext.mockResolvedValue(new TextEncoder().encode("Brankas Pribadi"));
  });

  it("decrypts, orders, and atomically persists one complete authorized online bundle without implicit enrollment writes", async () => {
    const userRootKey = Uint8Array.of(1);
    const personalVaultKey = Uint8Array.of(2);
    const sharedVaultKey = Uint8Array.of(3);
    mocks.fetchAuthorizedOfflineBundle.mockResolvedValue(bundle());
    mocks.unlockPersonalVault.mockResolvedValue({ userRootKey, personalVaultKey });
    mocks.unlockSharedVault.mockResolvedValue({ vaultKey: sharedVaultKey, name: "Tim Operasional" });
    mocks.decryptAccountConfiguration
      .mockResolvedValueOnce(account("Zulu", "personal@example.test"))
      .mockResolvedValueOnce(account("Alpha", "shared@example.test"));

    const workspace = await loadUnlockedVaultWorkspace("four random secret words", "personal-1");

    expect(workspace).toEqual(expect.objectContaining({ profileId: "profile-1", syncState: "CURRENT", userRootKey, unavailableSharedVaults: 0 }));
    expect(workspace.accounts.map(({ issuer, vaultName }) => ({ issuer, vaultName }))).toEqual([
      { issuer: "Alpha", vaultName: "Tim Operasional" },
      { issuer: "Zulu", vaultName: "Brankas Pribadi" }
    ]);
    expect(mocks.replace).toHaveBeenCalledWith(bundle());
  });

  it("loads the same online bundle from server-mediated Passkey-Assisted Unlock", async () => {
    const userRootKey = Uint8Array.of(1);
    const personalVaultKey = Uint8Array.of(2);
    mocks.fetchAuthorizedOfflineBundle.mockResolvedValue(bundle({ sharedVaults: [] }));
    mocks.recoverUserRootKeyWithPasskey.mockResolvedValue(userRootKey);
    mocks.unlockPersonalVaultWithUserRootKey.mockResolvedValue(personalVaultKey);

    const workspace = await loadUnlockedVaultWorkspaceWithPasskey("personal-1");

    expect(mocks.recoverUserRootKeyWithPasskey).toHaveBeenCalledOnce();
    expect(workspace.syncState).toBe("CURRENT");
    expect(mocks.replace).toHaveBeenCalledOnce();
  });

  it("persists and server-rewraps a legacy profile after a successful passphrase unlock", async () => {
    const original = bundle({ sharedVaults: [] });
    const migratedProfile = {
      vaultUnlockSalt: Uint8Array.of(10, 11),
      wrappedUserRootKey: Uint8Array.of(12, 13),
      encryptedPersonalVaultKey: Uint8Array.of(14, 15),
      encryptionVersion: 1
    };
    const userRootKey = Uint8Array.of(1);
    const personalVaultKey = Uint8Array.of(2);
    mocks.fetchAuthorizedOfflineBundle.mockResolvedValue(original);
    mocks.unlockPersonalVault.mockResolvedValue({ userRootKey, personalVaultKey, migratedProfile });

    await loadUnlockedVaultWorkspace("legacy secret", "personal-1");

    expect(mocks.rewrapUserCryptoProfile).toHaveBeenCalledWith({
      vaultUnlockSalt: "Cgs=",
      wrappedUserRootKey: "DA0=",
      encryptedPersonalVaultKey: "Dg8=",
      encryptionVersion: 1
    });
    expect(mocks.replace).toHaveBeenCalledWith(expect.objectContaining({
      cryptoProfile: {
        vaultUnlockSalt: "Cgs=",
        wrappedUserRootKey: "DA0=",
        encryptedPersonalVaultKey: "Dg8=",
        encryptionVersion: 1
      }
    }));
  });

  it("loads a fresh authorized online bundle through PRF-bound Remembered Browser unlock", async () => {
    const userRootKey = Uint8Array.of(3);
    mocks.fetchAuthorizedOfflineBundle.mockResolvedValue(bundle({ sharedVaults: [] }));
    mocks.recoverUserRootKeyWithRememberedBrowser.mockResolvedValue(userRootKey);
    mocks.unlockPersonalVaultWithUserRootKey.mockResolvedValue(Uint8Array.of(4));

    const workspace = await loadUnlockedVaultWorkspaceWithRememberedBrowser("personal-1");

    expect(mocks.fetchAuthorizedOfflineBundle).toHaveBeenCalledOnce();
    expect(mocks.recoverUserRootKeyWithRememberedBrowser).toHaveBeenCalledWith("profile-1", undefined);
    expect(workspace.syncState).toBe("CURRENT");
    expect(mocks.replace).toHaveBeenCalledOnce();
  });

  it("unlocks a validated local bundle with no network call and supports PRF-bound Remembered Browser fallback", async () => {
    const local = bundle({ sharedVaults: [] });
    mocks.read.mockResolvedValue(local);
    mocks.unlockPersonalVault.mockResolvedValue({ userRootKey: Uint8Array.of(1), personalVaultKey: Uint8Array.of(2) });
    mocks.recoverUserRootKeyWithRememberedBrowser.mockResolvedValue(Uint8Array.of(3));
    mocks.unlockPersonalVaultWithUserRootKey.mockResolvedValue(Uint8Array.of(4));

    const secretWorkspace = await loadOfflineVaultWorkspace("profile-1", "secret");
    const rememberedWorkspace = await loadOfflineVaultWorkspaceWithRememberedBrowser("profile-1");

    expect(secretWorkspace.syncState).toBe("OFFLINE");
    expect(rememberedWorkspace.syncState).toBe("OFFLINE");
    expect(mocks.fetchAuthorizedOfflineBundle).not.toHaveBeenCalled();
    expect(mocks.recoverUserRootKeyWithRememberedBrowser).toHaveBeenCalledWith("profile-1");
  });

  it("persists ciphertext concurrently and bounds account decryption concurrency", async () => {
    const largeBundle = bundle({ sharedVaults: [] });
    largeBundle.personalVault.accounts = Array.from({ length: 25 }, (_, index) => ({ id: `account-${index}`, encryptedPayload: "BQ==", encryptionVersion: 1 as const, revision: 1 }));
    mocks.fetchAuthorizedOfflineBundle.mockResolvedValue(largeBundle);
    mocks.unlockPersonalVault.mockResolvedValue({ userRootKey: Uint8Array.of(1), personalVaultKey: Uint8Array.of(2) });
    let active = 0;
    let maximumActive = 0;
    mocks.decryptAccountConfiguration.mockImplementation(() => new Promise((resolve) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      queueMicrotask(() => { active -= 1; resolve(account("Issuer", "account")); });
    }));

    const loading = loadUnlockedVaultWorkspace("secret", "personal-1");
    await vi.waitFor(() => expect(mocks.replace).toHaveBeenCalledWith(largeBundle));
    const workspace = await loading;

    expect(workspace.accounts).toHaveLength(25);
    expect(maximumActive).toBe(8);
  });

  it("rejects reconciliation for a different authenticated profile and clears the copied key", async () => {
    mocks.fetchAuthorizedOfflineBundle.mockResolvedValue(bundle({ profileId: "profile-2" }));
    const userRootKey = Uint8Array.of(7);

    await expect(refreshUnlockedVaultWorkspace(userRootKey, "profile-1")).rejects.toThrow(/does not match/);
    expect([...userRootKey]).toEqual([7]);
    expect(mocks.unlockPersonalVaultWithUserRootKey).not.toHaveBeenCalled();
  });

  it("isolates one malformed account without making its Shared Vault unavailable", async () => {
    mocks.fetchAuthorizedOfflineBundle.mockResolvedValue(bundle({ sharedVaults: [{ ...sharedVault(), accounts: [
      { id: "shared-valid", encryptedPayload: "CA==", encryptionVersion: 1 as const, revision: 1 },
      { id: "shared-invalid", encryptedPayload: "CQ==", encryptionVersion: 1 as const, revision: 4 }
    ] }] }));
    mocks.unlockPersonalVault.mockResolvedValue({ userRootKey: Uint8Array.of(1), personalVaultKey: Uint8Array.of(2) });
    mocks.unlockSharedVault.mockResolvedValue({ vaultKey: Uint8Array.of(3), name: "Tim" });
    mocks.decryptAccountConfiguration
      .mockResolvedValueOnce(account("Personal", "owner"))
      .mockResolvedValueOnce(account("Shared", "valid"))
      .mockRejectedValueOnce(new Error("invalid authenticated payload"));

    const workspace = await loadUnlockedVaultWorkspace("secret", "personal-1");

    expect(workspace.vaults.map((vault) => vault.id)).toContain("shared-1");
    expect(workspace.accounts.map(({ id }) => id)).toContain("shared-valid");
    expect(workspace.unavailableAccounts).toEqual([{ id: "shared-invalid", vaultId: "shared-1", vaultName: "Tim", vaultType: "SHARED", revision: 4 }]);
    expect(workspace.unavailableSharedVaults).toBe(0);
  });

  it("keeps valid accounts available when one Shared Vault cannot be decrypted and clears all key material on lock", async () => {
    mocks.fetchAuthorizedOfflineBundle.mockResolvedValue(bundle({ sharedVaults: [sharedVault("shared-good"), sharedVault("shared-bad")] }));
    mocks.unlockPersonalVault.mockResolvedValue({ userRootKey: Uint8Array.of(1), personalVaultKey: Uint8Array.of(2) });
    mocks.unlockSharedVault.mockResolvedValueOnce({ vaultKey: Uint8Array.of(3), name: "Tim" }).mockRejectedValueOnce(new Error("invalid"));
    const secret = Uint8Array.of(9);
    mocks.decryptAccountConfiguration.mockResolvedValue(account("Issuer", "account", secret));

    const workspace = await loadUnlockedVaultWorkspace("secret", "personal-1");
    expect(workspace.vaults.map((vault) => vault.id)).toEqual(["personal-1", "shared-good"]);
    expect(workspace.unavailableSharedVaults).toBe(1);

    clearUnlockedVaultWorkspace(workspace);
    expect([...workspace.userRootKey]).toEqual([0]);
    expect(workspace.vaults.every((vault) => vault.key.every((value) => value === 0))).toBe(true);
    expect([...secret]).toEqual([0]);
  });
});

function account(issuer: string, accountName: string, secret = Uint8Array.of(9)) {
  return { issuer, accountName, secret, algorithm: "SHA-1" as const, digits: 6 as const, period: 30 };
}

function sharedVault(vaultId = "shared-1") {
  return { vaultId, lifecycle: "ACTIVE" as const, role: "VIEWER" as const, effectiveAccountPermissions: { permissions: { canAddAccounts: false, canEditAccounts: false, canDeleteAccounts: false }, sources: { canAddAccounts: "VAULT" as const, canEditAccounts: "VAULT" as const, canDeleteAccounts: "VAULT" as const } }, encryptedName: "Bg==", encryptionVersion: 1 as const, encryptedVaultKey: "Bw==", keyVersion: 1, accounts: [] };
}

function bundle(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 2 as const,
    profileId: "profile-1",
    synchronizedAt: "2026-01-01T00:00:00.000Z",
    synchronizationToken: "sync-1",
    cryptoProfile: { vaultUnlockSalt: "AQ==", wrappedUserRootKey: "Ag==", encryptedPersonalVaultKey: "Aw==", encryptionVersion: 1 as const },
    personalVault: { vaultId: "personal-1", lifecycle: "ACTIVE" as const, encryptedName: "BA==", encryptionVersion: 1 as const, accounts: [{ id: "personal-account", encryptedPayload: "BQ==", encryptionVersion: 1 as const, revision: 1 }] },
    sharedVaults: [{ ...sharedVault(), accounts: [{ id: "shared-account", encryptedPayload: "CA==", encryptionVersion: 1 as const, revision: 1 }] }],
    ...overrides
  };
}
