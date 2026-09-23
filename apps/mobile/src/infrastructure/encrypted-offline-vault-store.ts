import type { ClientCryptoPort } from "@rhasia-scret/client-vault-core";
import type { CryptoEnvelopeContext } from "@rhasia-scret/client-vault-core";
import type {
  EncryptedPersonalOfflineSnapshot,
  OfflineProfileDiscovery,
  OfflineProfileSummary,
  OfflineVaultSnapshotStore,
} from "@rhasia-scret/client-vault-core";
import { LegacySharedVaultSnapshotError, parseEncryptedPersonalOfflineSnapshot } from "@rhasia-scret/client-vault-core";
import { base64ToBytes, bytesToBase64 } from "@rhasia-scret/client-vault-core";

const STORAGE_KEY = "rhasia.mobile.offline-vault.encryption-key.v1";
const CONTEXT: CryptoEnvelopeContext = {
  purpose: "native-offline-snapshot",
  payloadType: "encrypted-vault-bundles",
  keyVersion: 1,
};

type PersistedStore = { version: 1; profiles: Record<string, EncryptedPersonalOfflineSnapshot> };
type LoadedStore = { store: PersistedStore; migrationRequired: boolean };

export interface EncryptedBlobPersistence {
  read(): Promise<Uint8Array | null>;
  replace(bytes: Uint8Array): Promise<void>;
  remove(): Promise<void>;
}

export interface SecureKeyValueStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export class EncryptedOfflineVaultStore implements OfflineVaultSnapshotStore {
  private operation = Promise.resolve();

  public constructor(
    private readonly persistence: EncryptedBlobPersistence,
    private readonly secureKeys: SecureKeyValueStorage,
    private readonly crypto: ClientCryptoPort,
  ) {}

  public listProfiles(): Promise<OfflineProfileDiscovery> {
    return this.exclusive(async () => {
      const loaded = await this.load();
      const profiles: OfflineProfileSummary[] = Object.values(loaded.store.profiles)
        .map((bundle) => ({
          profileId: bundle.profileId,
          personalVaultId: bundle.personalVault.vaultId,
          synchronizedAt: bundle.synchronizedAt,
          sharedVaultCount: 0 as const,
        }))
        .sort((left, right) => right.synchronizedAt.localeCompare(left.synchronizedAt));
      return { profiles, migrationRequired: loaded.migrationRequired };
    });
  }

  public read(profileId: string): Promise<EncryptedPersonalOfflineSnapshot | null> {
    return this.exclusive(async () => (await this.load()).store.profiles[profileId] ?? null);
  }

  public readByPersonalVaultId(personalVaultId: string): Promise<EncryptedPersonalOfflineSnapshot | null> {
    return this.exclusive(
      async () =>
        Object.values((await this.load()).store.profiles).find(
          (bundle) => bundle.personalVault.vaultId === personalVaultId,
        ) ?? null,
    );
  }

  public replace(bundleInput: EncryptedPersonalOfflineSnapshot): Promise<void> {
    return this.exclusive(async () => {
      const bundle = parseEncryptedPersonalOfflineSnapshot(bundleInput);
      const store = (await this.load()).store;
      const current = store.profiles[bundle.profileId];
      if (current && bundle.synchronizedAt < current.synchronizedAt) {
        throw new Error("A Local Vault Snapshot cannot regress to an older synchronization time.");
      }
      store.profiles[bundle.profileId] = bundle;
      await this.persist(store);
    });
  }

  public removeVault(profileId: string, vaultId: string): Promise<void> {
    return this.exclusive(async () => {
      const store = (await this.load()).store;
      const bundle = store.profiles[profileId];
      if (!bundle || bundle.personalVault.vaultId !== vaultId) return;
      delete store.profiles[profileId];
      await this.persist(store);
    });
  }

  public removeProfile(profileId: string): Promise<void> {
    return this.exclusive(async () => {
      const store = (await this.load()).store;
      if (!store.profiles[profileId]) return;
      delete store.profiles[profileId];
      await this.persist(store);
    });
  }

  public clearAll(): Promise<void> {
    return this.exclusive(async () => {
      await this.persistence.remove();
      await this.secureKeys.remove(STORAGE_KEY);
    });
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operation.then(operation, operation);
    this.operation = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async load(): Promise<LoadedStore> {
    const encrypted = await this.persistence.read();
    if (!encrypted) {
      await this.secureKeys.remove(STORAGE_KEY);
      return { store: { version: 1, profiles: {} }, migrationRequired: false };
    }
    const key = await this.loadExistingKey();
    try {
      const envelope = this.crypto.deserializeEncryptedEnvelope(encrypted);
      if (envelope.version !== 2) throw new Error("Native encrypted Vault storage has an unsupported version.");
      const plaintext = await this.crypto.decryptPayloadWithContext(key, envelope, CONTEXT);
      try {
        try {
          return {
            store: parseStore(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext))),
            migrationRequired: false,
          };
        } catch (error) {
          if (!(error instanceof LegacySharedVaultSnapshotError)) throw error;
          await this.persistence.remove();
          await this.secureKeys.remove(STORAGE_KEY);
          return { store: { version: 1, profiles: {} }, migrationRequired: true };
        }
      } finally {
        plaintext.fill(0);
      }
    } finally {
      key.fill(0);
    }
  }

  private async persist(store: PersistedStore): Promise<void> {
    if (Object.keys(store.profiles).length === 0) {
      await this.persistence.remove();
      await this.secureKeys.remove(STORAGE_KEY);
      return;
    }
    const key = await this.loadOrCreateKey();
    const plaintext = new TextEncoder().encode(JSON.stringify(store));
    try {
      const envelope = await this.crypto.encryptPayloadWithContext(key, plaintext, CONTEXT);
      await this.persistence.replace(this.crypto.serializeEncryptedEnvelope(envelope));
    } finally {
      plaintext.fill(0);
      key.fill(0);
    }
  }

  private async loadExistingKey(): Promise<Uint8Array> {
    const encoded = await this.secureKeys.get(STORAGE_KEY);
    if (!encoded) throw new Error("Native encrypted Vault storage key is unavailable.");
    const key = base64ToBytes(encoded);
    if (key.length !== 32) {
      key.fill(0);
      throw new Error("Native encrypted Vault storage key is invalid.");
    }
    return key;
  }

  private async loadOrCreateKey(): Promise<Uint8Array> {
    const encoded = await this.secureKeys.get(STORAGE_KEY);
    if (encoded) return this.loadExistingKey();
    const key = this.crypto.generateSymmetricKey();
    try {
      await this.secureKeys.set(STORAGE_KEY, bytesToBase64(key));
      return key;
    } catch (error) {
      key.fill(0);
      throw error;
    }
  }
}

function parseStore(value: unknown): PersistedStore {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalidStore();
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || !record.profiles || typeof record.profiles !== "object" || Array.isArray(record.profiles))
    invalidStore();
  if (Object.keys(record).sort().join(",") !== "profiles,version") invalidStore();
  const profiles: Record<string, EncryptedPersonalOfflineSnapshot> = {};
  for (const [profileId, bundleValue] of Object.entries(record.profiles as Record<string, unknown>)) {
    const bundle = parseEncryptedPersonalOfflineSnapshot(bundleValue);
    if (bundle.profileId !== profileId) invalidStore();
    profiles[profileId] = bundle;
  }
  return { version: 1, profiles };
}

function invalidStore(): never {
  throw new Error("Native encrypted Vault storage is invalid.");
}
