"use client";

import { parseEncryptedOfflineVaultBundle, type EncryptedOfflineVaultBundle } from "../domain/offline-vault-bundle";

const DATABASE_NAME = "rhasia-scret-offline-vault";
const DATABASE_VERSION = 1;
const SNAPSHOT_STORE = "encrypted-snapshots";
const REMEMBERED_STORE = "remembered-browsers";

export type OfflineProfileSummary = {
  profileId: string;
  personalVaultId: string;
  synchronizedAt: string;
  sharedVaultCount: number;
};

export type RememberedBrowserPackage = {
  version: 1;
  profileId: string;
  rpId: string;
  origin: string;
  credentialId: string;
  encryptedUserRootKeyPackage: string;
  enrolledAt: string;
};

export class BrowserOfflineVaultRepository {
  constructor(private readonly openDatabase: () => Promise<IDBDatabase> = openOfflineDatabase) {}

  async listProfiles(): Promise<OfflineProfileSummary[]> {
    const database = await this.openDatabase();
    try {
      const records = await request<unknown[]>(database.transaction(SNAPSHOT_STORE, "readonly").objectStore(SNAPSHOT_STORE).getAll());
      return records.flatMap((record) => {
        try {
          const bundle = parseEncryptedOfflineVaultBundle(record);
          return [{ profileId: bundle.profileId, personalVaultId: bundle.personalVault.vaultId, synchronizedAt: bundle.synchronizedAt, sharedVaultCount: bundle.sharedVaults.length }];
        } catch {
          return [];
        }
      }).sort((left, right) => right.synchronizedAt.localeCompare(left.synchronizedAt));
    } finally {
      database.close();
    }
  }

  async read(profileId: string): Promise<EncryptedOfflineVaultBundle | null> {
    const database = await this.openDatabase();
    try {
      const value = await request<unknown>(database.transaction(SNAPSHOT_STORE, "readonly").objectStore(SNAPSHOT_STORE).get(profileId));
      return value === undefined ? null : parseEncryptedOfflineVaultBundle(value);
    } finally {
      database.close();
    }
  }

  async replace(bundleInput: EncryptedOfflineVaultBundle): Promise<void> {
    const bundle = parseEncryptedOfflineVaultBundle(bundleInput);
    const database = await this.openDatabase();
    try {
      const transaction = database.transaction(SNAPSHOT_STORE, "readwrite");
      const store = transaction.objectStore(SNAPSHOT_STORE);
      const previous = await request<unknown>(store.get(bundle.profileId));
      if (previous !== undefined) {
        const current = parseEncryptedOfflineVaultBundle(previous);
        if (new Date(bundle.synchronizedAt).getTime() < new Date(current.synchronizedAt).getTime()) {
          transaction.abort();
          throw new Error("A Local Vault Snapshot cannot regress to an older synchronization time.");
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
        const bundle = parseEncryptedOfflineVaultBundle(value);
        if (bundle.personalVault.vaultId === vaultId) store.delete(profileId);
        else store.put({ ...bundle, sharedVaults: bundle.sharedVaults.filter((vault) => vault.vaultId !== vaultId) });
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
      const value = await request<unknown>(database.transaction(REMEMBERED_STORE, "readonly").objectStore(REMEMBERED_STORE).get(profileId));
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
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Remembered Browser package is invalid.");
  const record = value as Record<string, unknown>;
  const expected = ["credentialId", "encryptedUserRootKeyPackage", "enrolledAt", "origin", "profileId", "rpId", "version"];
  const keys = Object.keys(record).sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) throw new Error("Remembered Browser package is invalid.");
  if (record.version !== 1 || !opaque(record.profileId) || !host(record.rpId) || !httpOrigin(record.origin) || !base64(record.credentialId) || !base64(record.encryptedUserRootKeyPackage) || !isoTimestamp(record.enrolledAt)) throw new Error("Remembered Browser package is invalid.");
  return record as RememberedBrowserPackage;
}

export async function clearAllOfflineVaultData(): Promise<void> {
  await new BrowserOfflineVaultRepository().clearAll();
}

function openOfflineDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB is unavailable."));
  return new Promise((resolve, reject) => {
    const openRequest = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    openRequest.onupgradeneeded = () => {
      const database = openRequest.result;
      if (!database.objectStoreNames.contains(SNAPSHOT_STORE)) database.createObjectStore(SNAPSHOT_STORE, { keyPath: "profileId" });
      if (!database.objectStoreNames.contains(REMEMBERED_STORE)) database.createObjectStore(REMEMBERED_STORE, { keyPath: "profileId" });
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
    transaction.onabort = () => reject(transaction.error ?? new Error("Offline Vault storage transaction was aborted."));
  });
}

function opaque(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9_-]{1,256}$/.test(value); }
function host(value: unknown): value is string { return typeof value === "string" && /^(?:[A-Za-z0-9-]+\.)*[A-Za-z0-9-]+$/.test(value) && value.length <= 253; }
function httpOrigin(value: unknown): value is string { if (typeof value !== "string") return false; try { const url = new URL(value); return url.origin === value && (url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))); } catch { return false; } }
function base64(value: unknown): value is string { return typeof value === "string" && value.length >= 4 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value); }
function isoTimestamp(value: unknown): value is string { return typeof value === "string" && Number.isFinite(new Date(value).getTime()) && new Date(value).toISOString() === value; }
