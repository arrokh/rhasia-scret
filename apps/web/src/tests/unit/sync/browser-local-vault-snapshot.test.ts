import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  BrowserOfflineVaultRepository,
  LegacySharedVaultSnapshotError,
  parseEncryptedPersonalOfflineSnapshot,
  type EncryptedPersonalOfflineSnapshot,
} from "@/modules/sync";

const ciphertext = Buffer.from([1, ...Array<number>(31).fill(7)]).toString("base64");
const salt = Buffer.alloc(16, 8).toString("base64");

function snapshot(profileId: string, synchronizedAt = "2026-01-01T00:00:00.000Z"): EncryptedPersonalOfflineSnapshot {
  return parseEncryptedPersonalOfflineSnapshot({
    schemaVersion: 3,
    profileId,
    synchronizedAt,
    synchronizationToken: synchronizedAt,
    cryptoProfile: {
      vaultUnlockSalt: salt,
      wrappedUserRootKey: ciphertext,
      encryptedPersonalVaultKey: ciphertext,
      encryptionVersion: 1,
    },
    personalVault: {
      vaultId: `personal_${profileId}`,
      lifecycle: "ACTIVE",
      encryptedName: ciphertext,
      encryptionVersion: 1,
      accounts: [{ id: "personal_account", encryptedPayload: ciphertext, encryptionVersion: 1, revision: 1 }],
    },
  });
}

function legacyBundle(profileId: string) {
  return {
    schemaVersion: 2,
    profileId,
    synchronizedAt: "2026-01-01T00:00:00.000Z",
    synchronizationToken: "legacy-token",
    cryptoProfile: snapshot(profileId).cryptoProfile,
    personalVault: snapshot(profileId).personalVault,
    sharedVaults: [],
  };
}

describe("BrowserOfflineVaultRepository", () => {
  const repository = new BrowserOfflineVaultRepository();
  beforeEach(async () => repository.clearAll());

  it("discovers and reads only Personal Vault snapshots", async () => {
    await repository.replace(snapshot("profile_a"));
    await repository.replace(snapshot("profile_b", "2026-01-02T00:00:00.000Z"));

    expect(await repository.listProfiles()).toEqual({
      migrationRequired: false,
      profiles: [
        {
          profileId: "profile_b",
          personalVaultId: "personal_profile_b",
          synchronizedAt: "2026-01-02T00:00:00.000Z",
          sharedVaultCount: 0,
        },
        {
          profileId: "profile_a",
          personalVaultId: "personal_profile_a",
          synchronizedAt: "2026-01-01T00:00:00.000Z",
          sharedVaultCount: 0,
        },
      ],
    });
    expect((await repository.read("profile_a"))?.schemaVersion).toBe(3);
    expect((await repository.readByPersonalVaultId("personal_profile_b"))?.profileId).toBe("profile_b");
  });

  it("rejects legacy Shared Vault snapshots and malformed records", async () => {
    expect(() => parseEncryptedPersonalOfflineSnapshot(legacyBundle("profile_a"))).toThrow(
      LegacySharedVaultSnapshotError,
    );
    expect(() => parseEncryptedPersonalOfflineSnapshot({ ...snapshot("profile_a"), schemaVersion: 2 })).toThrow(
      /unsupported snapshot schema/,
    );
    await expect(repository.replace(snapshot("profile_a", "2026-01-02T00:00:00.000Z"))).resolves.toBeUndefined();
    await expect(repository.replace(snapshot("profile_a"))).rejects.toThrow(/cannot regress/);
  });

  it("deletes legacy snapshots and their remembered browser material", async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("rhasia-scret-offline-vault", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction(["encrypted-snapshots", "remembered-browsers"], "readwrite");
    transaction.objectStore("encrypted-snapshots").put(legacyBundle("legacy_profile"));
    transaction.objectStore("remembered-browsers").put({ profileId: "legacy_profile" });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();

    expect((await repository.listProfiles()).migrationRequired).toBe(true);
    expect(await repository.read("legacy_profile")).toBeNull();
    expect(await repository.readRememberedBrowser("legacy_profile")).toBeNull();
  });

  it("replaces a legacy snapshot without retaining remembered-browser material", async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("rhasia-scret-offline-vault", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction(["encrypted-snapshots", "remembered-browsers"], "readwrite");
    transaction.objectStore("encrypted-snapshots").put(legacyBundle("profile_a"));
    transaction.objectStore("remembered-browsers").put({ profileId: "profile_a" });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();

    await repository.replace(snapshot("profile_a", "2026-01-02T00:00:00.000Z"));

    expect(await repository.read("profile_a")).not.toBeNull();
    expect(await repository.readRememberedBrowser("profile_a")).toBeNull();
  });

  it("cleans a legacy snapshot when read directly before offline unlock", async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("rhasia-scret-offline-vault", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction(["encrypted-snapshots", "remembered-browsers"], "readwrite");
    transaction.objectStore("encrypted-snapshots").put(legacyBundle("legacy_profile"));
    transaction.objectStore("remembered-browsers").put({ profileId: "legacy_profile" });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();

    await expect(repository.read("legacy_profile")).rejects.toBeInstanceOf(LegacySharedVaultSnapshotError);
    expect(await repository.readRememberedBrowser("legacy_profile")).toBeNull();
    expect(await repository.read("legacy_profile")).toBeNull();
  });

  it("cleans discovered legacy records but fails closed on unrelated malformed records", async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("rhasia-scret-offline-vault", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction(["encrypted-snapshots", "remembered-browsers"], "readwrite");
    transaction.objectStore("encrypted-snapshots").put(legacyBundle("legacy_profile"));
    transaction.objectStore("encrypted-snapshots").put({ profileId: "malformed_profile", schemaVersion: 2 });
    transaction.objectStore("remembered-browsers").put({ profileId: "legacy_profile" });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();

    await expect(repository.readByPersonalVaultId("unrelated_personal_vault")).rejects.toThrow(
      /Invalid encrypted offline bundle/,
    );
    expect(await repository.read("legacy_profile")).toBeNull();
    expect(await repository.readRememberedBrowser("legacy_profile")).toBeNull();
  });

  it("removes a Personal Vault snapshot without affecting another profile", async () => {
    await repository.replace(snapshot("profile_a"));
    await repository.replace(snapshot("profile_b"));
    await repository.removeVault("profile_a", "personal_profile_a");
    expect(await repository.read("profile_a")).toBeNull();
    expect(await repository.read("profile_b")).not.toBeNull();
  });
});
