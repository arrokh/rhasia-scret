import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { BrowserOfflineVaultRepository, parseEncryptedOfflineVaultBundle, type EncryptedOfflineVaultBundle } from "@/modules/sync";

const ciphertext = Buffer.from([1, ...Array<number>(31).fill(7)]).toString("base64");
const salt = Buffer.alloc(16, 8).toString("base64");

function bundle(profileId: string, synchronizedAt = "2026-01-01T00:00:00.000Z"): EncryptedOfflineVaultBundle {
  return parseEncryptedOfflineVaultBundle({
    schemaVersion: 1,
    profileId,
    synchronizedAt,
    synchronizationToken: synchronizedAt,
    cryptoProfile: { vaultUnlockSalt: salt, wrappedUserRootKey: ciphertext, encryptedPersonalVaultKey: ciphertext, encryptionVersion: 1 },
    personalVault: {
      vaultId: `personal_${profileId}`,
      lifecycle: "ACTIVE",
      encryptedName: ciphertext,
      encryptionVersion: 1,
      accounts: [{ id: "personal_account", encryptedPayload: ciphertext, encryptionVersion: 1, revision: 1 }]
    },
    sharedVaults: [{
      vaultId: `shared_${profileId}`,
      lifecycle: "ACTIVE",
      role: "VIEWER",
      encryptedName: ciphertext,
      encryptionVersion: 1,
      encryptedVaultKey: ciphertext,
      keyVersion: 1,
      accounts: [{ id: "shared_account", encryptedPayload: ciphertext, encryptionVersion: 1, revision: 2 }]
    }]
  });
}

describe("BrowserOfflineVaultRepository", () => {
  const repository = new BrowserOfflineVaultRepository();
  beforeEach(async () => repository.clearAll());

  it("discovers opaque profiles and atomically reads complete validated bundles", async () => {
    await repository.replace(bundle("profile_a"));
    await repository.replace(bundle("profile_b", "2026-01-02T00:00:00.000Z"));

    expect(await repository.listProfiles()).toEqual([
      { profileId: "profile_b", personalVaultId: "personal_profile_b", synchronizedAt: "2026-01-02T00:00:00.000Z", sharedVaultCount: 1 },
      { profileId: "profile_a", personalVaultId: "personal_profile_a", synchronizedAt: "2026-01-01T00:00:00.000Z", sharedVaultCount: 1 }
    ]);
    const restored = await repository.read("profile_a");
    expect(restored?.personalVault.accounts).toHaveLength(1);
    expect(restored?.schemaVersion).toBe(2);
    expect(restored?.sharedVaults[0]?.effectiveAccountPermissions).toEqual({
      permissions: { canAddAccounts: false, canEditAccounts: false, canDeleteAccounts: false },
      sources: { canAddAccounts: "VAULT", canEditAccounts: "VAULT", canDeleteAccounts: "VAULT" }
    });
  });

  it("rejects malformed, plaintext-shaped, unknown-version, incomplete, and regressing records while preserving the last valid bundle", async () => {
    const current = bundle("profile_a", "2026-01-02T00:00:00.000Z");
    await repository.replace(current);

    expect(() => parseEncryptedOfflineVaultBundle({ ...current, schemaVersion: 3 })).toThrow(/unsupported schema/);
    expect(() => parseEncryptedOfflineVaultBundle({ ...current, cryptoProfile: { ...current.cryptoProfile, wrappedUserRootKey: "plaintext secret" } })).toThrow(/base64/);
    const unknownEnvelope = Buffer.from([2, ...Array<number>(31).fill(7)]).toString("base64");
    expect(() => parseEncryptedOfflineVaultBundle({ ...current, cryptoProfile: { ...current.cryptoProfile, wrappedUserRootKey: unknownEnvelope } })).toThrow(/envelope version/);
    expect(() => parseEncryptedOfflineVaultBundle({ ...current, personalVault: { vaultId: "missing" } })).toThrow(/unexpected or missing/);
    await expect(repository.replace(bundle("profile_a", "2026-01-01T00:00:00.000Z"))).rejects.toThrow(/cannot regress/);
    expect((await repository.read("profile_a"))?.synchronizedAt).toBe(current.synchronizedAt);
  });

  it("preserves the last valid bundle when an IndexedDB upgrade aborts", async () => {
    await repository.replace(bundle("profile_a"));
    await expect(new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("rhasia-scret-offline-vault", 2);
      request.onupgradeneeded = () => request.transaction?.abort();
      request.onsuccess = () => { request.result.close(); resolve(); };
      request.onerror = () => reject(request.error ?? new Error("upgrade aborted"));
    })).rejects.toBeTruthy();

    expect((await repository.read("profile_a"))?.personalVault.vaultId).toBe("personal_profile_a");
  });

  it("isolates profiles, removes one Shared Vault atomically, and clears snapshots with remembered packages", async () => {
    await repository.replace(bundle("profile_a"));
    await repository.replace(bundle("profile_b"));
    await repository.saveRememberedBrowser({
      version: 1,
      profileId: "profile_a",
      rpId: "localhost",
      origin: "http://localhost",
      credentialId: ciphertext,
      encryptedUserRootKeyPackage: ciphertext,
      enrolledAt: "2026-01-01T00:00:00.000Z"
    });

    await repository.removeVault("profile_a", "shared_profile_a");
    expect((await repository.read("profile_a"))?.sharedVaults).toEqual([]);
    expect(await repository.read("profile_b")).not.toBeNull();
    expect(await repository.readRememberedBrowser("profile_a")).not.toBeNull();

    await repository.removeProfile("profile_a");
    expect(await repository.read("profile_a")).toBeNull();
    expect(await repository.readRememberedBrowser("profile_a")).toBeNull();
    expect(await repository.read("profile_b")).not.toBeNull();

    await repository.clearAll();
    expect(await repository.listProfiles()).toEqual([]);
  });
});
