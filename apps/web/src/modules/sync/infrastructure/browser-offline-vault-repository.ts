"use client";

import type {
  ClientStoragePort,
  EncryptedPersonalOfflineSnapshot,
  OfflineProfileDiscovery,
  OfflineProfileSummary,
  RememberedBrowserPackage,
} from "@rhasia-scret/client-vault-core";
import { LegacySharedVaultSnapshotError, parseEncryptedPersonalOfflineSnapshot } from "@rhasia-scret/client-vault-core";

const DATABASE_NAME = "rhasia-scret-offline-vault";
const DATABASE_VERSION = 1;
const SNAPSHOT_STORE = "encrypted-snapshots";
const REMEMBERED_STORE = "remembered-browsers";

export type { OfflineProfileDiscovery, OfflineProfileSummary };

export class BrowserOfflineVaultRepository implements ClientStoragePort {
  constructor(private readonly openDatabase: () => Promise<IDBDatabase> = openOfflineDatabase) {}

  async listProfiles(): Promise<OfflineProfileDiscovery> {
    const database = await this.openDatabase();
    try {
      const transaction = database.transaction([SNAPSHOT_STORE, REMEMBERED_STORE], "readwrite");
      const snapshotStore = transaction.objectStore(SNAPSHOT_STORE);
      const rememberedStore = transaction.objectStore(REMEMBERED_STORE);
      const records = await request<unknown[]>(snapshotStore.getAll());
      const profiles: OfflineProfileSummary[] = [];
      let migrationRequired = false;
      for (const record of records) {
        try {
          const bundle = parseEncryptedPersonalOfflineSnapshot(record);
          profiles.push({
            profileId: bundle.profileId,
            personalVaultId: bundle.personalVault.vaultId,
            synchronizedAt: bundle.synchronizedAt,
            sharedVaultCount: 0,
          });
        } catch (error) {
          if (!(error instanceof LegacySharedVaultSnapshotError)) throw error;
          const profileId = legacyProfileId(record);
          if (!profileId) throw new Error("A legacy hosted snapshot could not be safely identified.");
          snapshotStore.delete(profileId);
          rememberedStore.delete(profileId);
          migrationRequired = true;
        }
      }
      await completed(transaction);
      return {
        profiles: profiles.sort((left, right) => right.synchronizedAt.localeCompare(left.synchronizedAt)),
        migrationRequired,
      };
    } finally {
      database.close();
    }
  }

  async read(profileId: string): Promise<EncryptedPersonalOfflineSnapshot | null> {
    const database = await this.openDatabase();
    try {
      const value = await request<unknown>(
        database.transaction(SNAPSHOT_STORE, "readonly").objectStore(SNAPSHOT_STORE).get(profileId),
      );
      if (value === undefined) return null;
      try {
        return parseEncryptedPersonalOfflineSnapshot(value);
      } catch (error) {
        if (!(error instanceof LegacySharedVaultSnapshotError)) throw error;
        await removeHostedRecord(database, profileId);
        throw error;
      }
    } finally {
      database.close();
    }
  }

  async readByPersonalVaultId(personalVaultId: string): Promise<EncryptedPersonalOfflineSnapshot | null> {
    const database = await this.openDatabase();
    try {
      const transaction = database.transaction(SNAPSHOT_STORE, "readonly");
      const values = await request<unknown[]>(transaction.objectStore(SNAPSHOT_STORE).getAll());
      let matchingBundle: EncryptedPersonalOfflineSnapshot | null = null;
      const legacyProfileIds: string[] = [];
      let invalidRecord: unknown;
      for (const value of values) {
        try {
          const bundle = parseEncryptedPersonalOfflineSnapshot(value);
          if (bundle.personalVault.vaultId === personalVaultId) matchingBundle = bundle;
        } catch (error) {
          if (!(error instanceof LegacySharedVaultSnapshotError)) {
            invalidRecord ??= error;
            continue;
          }
          const profileId = legacyProfileId(value);
          if (!profileId) throw new Error("A legacy hosted snapshot could not be safely identified.");
          legacyProfileIds.push(profileId);
        }
      }
      await completed(transaction);
      for (const profileId of legacyProfileIds) await removeHostedRecord(database, profileId);
      if (invalidRecord) throw invalidRecord;
      return matchingBundle;
    } finally {
      database.close();
    }
  }

  async replace(bundleInput: EncryptedPersonalOfflineSnapshot): Promise<void> {
    const bundle = parseEncryptedPersonalOfflineSnapshot(bundleInput);
    const database = await this.openDatabase();
    try {
      const transaction = database.transaction([SNAPSHOT_STORE, REMEMBERED_STORE], "readwrite");
      const store = transaction.objectStore(SNAPSHOT_STORE);
      const previous = await request<unknown>(store.get(bundle.profileId));
      if (previous !== undefined) {
        try {
          const current = parseEncryptedPersonalOfflineSnapshot(previous);
          if (new Date(bundle.synchronizedAt).getTime() < new Date(current.synchronizedAt).getTime()) {
            transaction.abort();
            throw new Error("A Local Vault Snapshot cannot regress to an older synchronization time.");
          }
        } catch (error) {
          if (!(error instanceof LegacySharedVaultSnapshotError)) throw error;
          store.delete(bundle.profileId);
          transaction.objectStore(REMEMBERED_STORE).delete(bundle.profileId);
        }
      }
      store.put(bundle);
      await completed(transaction);
    } finally {
      database.close();
    }
  }

  async removeVault(profileId: string, vaultId: string): Promise<void> {
    const database = await this.openDatabase();
    try {
      const transaction = database.transaction(SNAPSHOT_STORE, "readwrite");
      const store = transaction.objectStore(SNAPSHOT_STORE);
      const value = await request<unknown>(store.get(profileId));
      if (value !== undefined) {
        const bundle = parseEncryptedPersonalOfflineSnapshot(value);
        if (bundle.personalVault.vaultId === vaultId) store.delete(profileId);
      }
      await completed(transaction);
    } finally {
      database.close();
    }
  }

  async removeProfile(profileId: string): Promise<void> {
    const database = await this.openDatabase();
    try {
      const transaction = database.transaction([SNAPSHOT_STORE, REMEMBERED_STORE], "readwrite");
      transaction.objectStore(SNAPSHOT_STORE).delete(profileId);
      transaction.objectStore(REMEMBERED_STORE).delete(profileId);
      await completed(transaction);
    } finally {
      database.close();
    }
  }

  async clearAll(): Promise<void> {
    const database = await this.openDatabase();
    try {
      const transaction = database.transaction([SNAPSHOT_STORE, REMEMBERED_STORE], "readwrite");
      transaction.objectStore(SNAPSHOT_STORE).clear();
      transaction.objectStore(REMEMBERED_STORE).clear();
      await completed(transaction);
    } finally {
      database.close();
    }
  }

  async saveRememberedBrowser(packageInput: RememberedBrowserPackage): Promise<void> {
    const browserPackage = parseRememberedBrowserPackage(packageInput);
    const database = await this.openDatabase();
    try {
      const transaction = database.transaction(REMEMBERED_STORE, "readwrite");
      transaction.objectStore(REMEMBERED_STORE).put(browserPackage);
      await completed(transaction);
    } finally {
      database.close();
    }
  }

  async readRememberedBrowser(profileId: string): Promise<RememberedBrowserPackage | null> {
    const database = await this.openDatabase();
    try {
      const value = await request<unknown>(
        database.transaction(REMEMBERED_STORE, "readonly").objectStore(REMEMBERED_STORE).get(profileId),
      );
      return value === undefined ? null : parseRememberedBrowserPackage(value);
    } finally {
      database.close();
    }
  }

  async removeRememberedBrowser(profileId: string): Promise<void> {
    const database = await this.openDatabase();
    try {
      const transaction = database.transaction(REMEMBERED_STORE, "readwrite");
      transaction.objectStore(REMEMBERED_STORE).delete(profileId);
      await completed(transaction);
    } finally {
      database.close();
    }
  }
}

export function parseRememberedBrowserPackage(value: unknown): RememberedBrowserPackage {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Remembered Browser package is invalid.");
  const record = value as Record<string, unknown>;
  const expected = [
    "credentialId",
    "encryptedUserRootKeyPackage",
    "enrolledAt",
    "origin",
    "profileId",
    "rpId",
    "version",
  ];
  const keys = Object.keys(record).sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index]))
    throw new Error("Remembered Browser package is invalid.");
  if (
    record.version !== 1 ||
    !opaque(record.profileId) ||
    !host(record.rpId) ||
    !httpOrigin(record.origin) ||
    !base64(record.credentialId) ||
    !base64(record.encryptedUserRootKeyPackage) ||
    !isoTimestamp(record.enrolledAt)
  )
    throw new Error("Remembered Browser package is invalid.");
  return record as RememberedBrowserPackage;
}

export async function clearAllOfflineVaultData(): Promise<void> {
  await new BrowserOfflineVaultRepository().clearAll();
}

async function removeHostedRecord(database: IDBDatabase, profileId: string): Promise<void> {
  const transaction = database.transaction([SNAPSHOT_STORE, REMEMBERED_STORE], "readwrite");
  transaction.objectStore(SNAPSHOT_STORE).delete(profileId);
  transaction.objectStore(REMEMBERED_STORE).delete(profileId);
  await completed(transaction);
}

function legacyProfileId(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const profileId = (value as Record<string, unknown>).profileId;
  return typeof profileId === "string" && /^[A-Za-z0-9_-]{1,256}$/.test(profileId) ? profileId : null;
}

function openOfflineDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB is unavailable."));
  return new Promise((resolve, reject) => {
    const openRequest = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    openRequest.onupgradeneeded = () => {
      const database = openRequest.result;
      if (!database.objectStoreNames.contains(SNAPSHOT_STORE))
        database.createObjectStore(SNAPSHOT_STORE, { keyPath: "profileId" });
      if (!database.objectStoreNames.contains(REMEMBERED_STORE))
        database.createObjectStore(REMEMBERED_STORE, { keyPath: "profileId" });
    };
    openRequest.onerror = () => reject(openRequest.error ?? new Error("Could not open offline Vault storage."));
    openRequest.onblocked = () => reject(new Error("Offline Vault storage upgrade is blocked by another tab."));
    openRequest.onsuccess = () => resolve(openRequest.result);
  });
}

function request<T>(idbRequest: IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    idbRequest.onsuccess = () => resolve(idbRequest.result as T);
    idbRequest.onerror = () => reject(idbRequest.error ?? new Error("Offline Vault storage operation failed."));
  });
}

function completed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Offline Vault storage transaction failed."));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("Offline Vault storage transaction was aborted."));
  });
}

function opaque(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,256}$/.test(value);
}
function host(value: unknown): value is string {
  return typeof value === "string" && /^(?:[A-Za-z0-9-]+\.)*[A-Za-z0-9-]+$/.test(value) && value.length <= 253;
}
function httpOrigin(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      url.origin === value &&
      (url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))
    );
  } catch {
    return false;
  }
}
function base64(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 4 &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  );
}
function isoTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" && Number.isFinite(new Date(value).getTime()) && new Date(value).toISOString() === value
  );
}
