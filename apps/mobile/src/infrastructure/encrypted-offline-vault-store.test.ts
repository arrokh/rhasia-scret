import type { EncryptedOfflineVaultBundle } from "@rhasia-scret/client-vault-core";
import { bytesToBase64 } from "@rhasia-scret/client-vault-core";
import { nativeClientCrypto } from "./native-client-crypto";
import {
  EncryptedOfflineVaultStore,
  type EncryptedBlobPersistence,
  type SecureKeyValueStorage,
} from "./encrypted-offline-vault-store";

class MemoryBlob implements EncryptedBlobPersistence {
  public bytes: Uint8Array | null = null;
  read = async () => this.bytes?.slice() ?? null;
  replace = async (bytes: Uint8Array) => {
    this.bytes = bytes.slice();
  };
  remove = async () => {
    this.bytes = null;
  };
}

class MemoryKeys implements SecureKeyValueStorage {
  public values = new Map<string, string>();
  get = async (key: string) => this.values.get(key) ?? null;
  set = async (key: string, value: string) => {
    this.values.set(key, value);
  };
  remove = async (key: string) => {
    this.values.delete(key);
  };
}

describe("EncryptedOfflineVaultStore", () => {
  it("persists only a context-authenticated encrypted blob and round-trips snapshots", async () => {
    const persistence = new MemoryBlob();
    const keys = new MemoryKeys();
    const store = new EncryptedOfflineVaultStore(persistence, keys, nativeClientCrypto);
    const bundle = fixture();

    await store.replace(bundle);

    expect(persistence.bytes?.[0]).toBe(2);
    const persistedText = new TextDecoder().decode(persistence.bytes ?? new Uint8Array());
    expect(persistedText).not.toContain(bundle.profileId);
    expect(persistedText).not.toContain(bundle.personalVault.vaultId);
    expect(await store.read(bundle.profileId)).toEqual(bundle);
    expect(await store.readByPersonalVaultId(bundle.personalVault.vaultId)).toEqual(bundle);
    expect(await store.listProfiles()).toEqual([
      {
        profileId: bundle.profileId,
        personalVaultId: bundle.personalVault.vaultId,
        synchronizedAt: bundle.synchronizedAt,
        sharedVaultCount: 0,
      },
    ]);
  });

  it("rejects synchronization-time regression and clears file and device-bound storage key", async () => {
    const persistence = new MemoryBlob();
    const keys = new MemoryKeys();
    const store = new EncryptedOfflineVaultStore(persistence, keys, nativeClientCrypto);
    await store.replace(fixture("2026-08-11T22:00:00.000Z"));

    await expect(store.replace(fixture("2026-08-11T21:00:00.000Z"))).rejects.toThrow("cannot regress");
    await store.clearAll();

    expect(persistence.bytes).toBeNull();
    expect(keys.values.size).toBe(0);
  });

  it("fails closed when ciphertext remains but the Keychain or Keystore key is unavailable", async () => {
    const persistence = new MemoryBlob();
    const keys = new MemoryKeys();
    const store = new EncryptedOfflineVaultStore(persistence, keys, nativeClientCrypto);
    await store.replace(fixture());
    keys.values.clear();

    await expect(store.read("profile_1")).rejects.toThrow("key is unavailable");
  });
});

function fixture(synchronizedAt = "2026-08-11T22:00:00.000Z"): EncryptedOfflineVaultBundle {
  return {
    schemaVersion: 2,
    profileId: "profile_1",
    synchronizedAt,
    synchronizationToken: "sync-token-1",
    cryptoProfile: {
      vaultUnlockSalt: bytesToBase64(new Uint8Array(16).fill(1)),
      wrappedUserRootKey: envelope(2),
      encryptedPersonalVaultKey: envelope(3),
      encryptionVersion: 1,
    },
    personalVault: {
      vaultId: "vault_1",
      lifecycle: "ACTIVE",
      encryptedName: envelope(4),
      encryptionVersion: 1,
      accounts: [{ id: "account_1", encryptedPayload: envelope(5), encryptionVersion: 1, revision: 1 }],
    },
    sharedVaults: [],
  };
}

function envelope(fill: number): string {
  const bytes = new Uint8Array(29).fill(fill);
  bytes[0] = 2;
  return bytesToBase64(bytes);
}
