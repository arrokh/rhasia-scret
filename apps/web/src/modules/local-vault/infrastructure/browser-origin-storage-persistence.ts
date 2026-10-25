export type BrowserOriginStoragePersistenceStatus =
  "already_granted" | "not_granted" | "granted" | "denied" | "unavailable" | "error";

export type OriginStoragePersistenceManager = Pick<StorageManager, "persist" | "persisted">;

export class BrowserOriginStoragePersistenceClient {
  public constructor(
    private readonly storageManager: () => OriginStoragePersistenceManager | null = readStorageManager,
  ) {}

  public async readStatus(): Promise<BrowserOriginStoragePersistenceStatus> {
    try {
      const storage = this.storageManager();
      if (!storage) return "unavailable";
      return (await storage.persisted()) ? "already_granted" : "not_granted";
    } catch {
      return "error";
    }
  }

  public async request(): Promise<BrowserOriginStoragePersistenceStatus> {
    try {
      const storage = this.storageManager();
      if (!storage) return "unavailable";
      if (await storage.persisted()) return "already_granted";
      return (await storage.persist()) ? "granted" : "denied";
    } catch {
      return "error";
    }
  }
}

export const browserOriginStoragePersistenceClient = new BrowserOriginStoragePersistenceClient();

function readStorageManager(): OriginStoragePersistenceManager | null {
  if (typeof navigator === "undefined") return null;
  const storage = navigator.storage;
  if (typeof storage?.persist !== "function" || typeof storage.persisted !== "function") return null;
  return storage;
}
