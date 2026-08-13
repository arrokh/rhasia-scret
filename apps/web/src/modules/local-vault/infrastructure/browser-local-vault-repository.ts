"use client";

import type { LocalVaultCapabilityPort } from "../application/local-vault-capabilities";
import type { LocalVaultRepository } from "../application/local-vault-repository";
import { parseLocalVaultRecord, type LocalVaultRecord } from "../domain/local-vault-record";

const DATABASE_NAME = "rhasia-scret-local-vault";
const DATABASE_VERSION = 1;
const STORE_NAME = "local-vault";
const STORAGE_KEY = "singleton";

export class BrowserLocalVaultRepository implements LocalVaultRepository {
  constructor(private readonly openDatabase: () => Promise<IDBDatabase> = openLocalVaultDatabase) {}

  async read(): Promise<LocalVaultRecord | null> {
    const database = await this.openDatabase();
    try {
      const value = await request<unknown>(database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(STORAGE_KEY));
      return value === undefined ? null : parseLocalVaultRecord(value);
    } finally {
      database.close();
    }
  }

  async create(recordInput: LocalVaultRecord): Promise<void> {
    const record = parseLocalVaultRecord(recordInput);
    const database = await this.openDatabase();
    try {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const existing = await request<unknown>(store.get(STORAGE_KEY));
      if (existing !== undefined) {
        transaction.abort();
        throw new Error("A Local Profile already exists in this browser installation.");
      }
      store.put(record, STORAGE_KEY);
      await completed(transaction);
    } finally {
      database.close();
    }
  }

  async replace(recordInput: LocalVaultRecord): Promise<void> {
    const record = parseLocalVaultRecord(recordInput);
    const database = await this.openDatabase();
    try {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const existing = await request<unknown>(store.get(STORAGE_KEY));
      if (existing === undefined) {
        transaction.abort();
        throw new Error("The Local Profile does not exist.");
      }
      const current = parseLocalVaultRecord(existing);
      if (current.profileId !== record.profileId || current.createdAt !== record.createdAt) {
        transaction.abort();
        throw new Error("The Local Profile identity cannot change.");
      }
      store.put(record, STORAGE_KEY);
      await completed(transaction);
    } finally {
      database.close();
    }
  }

  async clear(): Promise<void> {
    const database = await this.openDatabase();
    try {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).delete(STORAGE_KEY);
      await completed(transaction);
    } finally {
      database.close();
    }
  }
}

export class BrowserLocalVaultCapabilities implements LocalVaultCapabilityPort {
  isAvailable(): boolean {
    return typeof indexedDB !== "undefined" && !!globalThis.crypto?.subtle;
  }
}

export const browserLocalVaultCapabilities = new BrowserLocalVaultCapabilities();

export async function readLocalVaultRecord(): Promise<LocalVaultRecord | null> {
  return new BrowserLocalVaultRepository().read();
}

export async function clearLocalVault(): Promise<void> {
  await new BrowserLocalVaultRepository().clear();
}

function openLocalVaultDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB is unavailable for the Local Vault."));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME);
    };
    request.onerror = () => reject(request.error ?? new Error("Could not open Local Vault storage."));
    request.onblocked = () => reject(new Error("Local Vault storage upgrade is blocked by another tab."));
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => database.close();
      resolve(database);
    };
  });
}

function request<T>(requestValue: IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    requestValue.onsuccess = () => resolve(requestValue.result as T);
    requestValue.onerror = () => reject(requestValue.error ?? new Error("Local Vault storage operation failed."));
  });
}

function completed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Local Vault storage transaction failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Local Vault storage transaction was aborted."));
  });
}
