import * as SecureStore from "expo-secure-store";

export interface SecureStorageDriver {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

const storageOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};
const chunkSize = 1_800;
const maximumChunks = 16;

type ChunkManifest = { slot: "a" | "b"; count: number };

export const nativeSecureStorageDriver: SecureStorageDriver = {
  getItem: (key) => SecureStore.getItemAsync(key, storageOptions),
  setItem: async (key, value) => {
    await SecureStore.setItemAsync(key, value, storageOptions);
  },
  removeItem: async (key) => {
    await SecureStore.deleteItemAsync(key, storageOptions);
  },
};

/** Keeps the complete Supabase session in bounded Keychain/Keystore chunks. */
export class SecureSupabaseSessionStorage {
  public constructor(private readonly driver: SecureStorageDriver = nativeSecureStorageDriver) {}

  public async getItem(key: string): Promise<string | null> {
    const baseKey = assertSafeKey(key);
    const manifest = parseManifest(await this.driver.getItem(manifestKey(baseKey)));
    if (!manifest) return null;
    const chunks = await Promise.all(
      Array.from({ length: manifest.count }, (_, index) =>
        this.driver.getItem(chunkKey(baseKey, manifest.slot, index)),
      ),
    );
    return chunks.some((chunk) => chunk === null) ? null : chunks.join("");
  }

  public async setItem(key: string, value: string): Promise<void> {
    const baseKey = assertSafeKey(key);
    const chunks = splitSession(value);
    const previous = parseManifest(await this.driver.getItem(manifestKey(baseKey)));
    const nextSlot = previous?.slot === "a" ? "b" : "a";
    await this.removeSlot(baseKey, nextSlot);
    await Promise.all(chunks.map((chunk, index) => this.driver.setItem(chunkKey(baseKey, nextSlot, index), chunk)));
    await this.driver.setItem(
      manifestKey(baseKey),
      JSON.stringify({ slot: nextSlot, count: chunks.length } satisfies ChunkManifest),
    );
    if (previous) await this.removeSlot(baseKey, previous.slot);
  }

  public async removeItem(key: string): Promise<void> {
    const baseKey = assertSafeKey(key);
    await Promise.all([this.removeSlot(baseKey, "a"), this.removeSlot(baseKey, "b")]);
    await this.driver.removeItem(manifestKey(baseKey));
  }

  private async removeSlot(baseKey: string, slot: ChunkManifest["slot"]): Promise<void> {
    await Promise.all(
      Array.from({ length: maximumChunks }, (_, index) => this.driver.removeItem(chunkKey(baseKey, slot, index))),
    );
  }
}

function splitSession(value: string): string[] {
  const chunks = Array.from({ length: Math.ceil(value.length / chunkSize) || 1 }, (_, index) =>
    value.slice(index * chunkSize, (index + 1) * chunkSize),
  );
  if (chunks.length > maximumChunks) throw new Error("Secure session package exceeds the supported size.");
  return chunks;
}

function parseManifest(value: string | null): ChunkManifest | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<ChunkManifest>;
    if (
      (parsed.slot === "a" || parsed.slot === "b") &&
      Number.isInteger(parsed.count) &&
      (parsed.count ?? 0) >= 1 &&
      (parsed.count ?? 0) <= maximumChunks
    ) {
      return { slot: parsed.slot, count: parsed.count as number };
    }
  } catch {
    // Corrupt secure state fails closed and requires a new provider session.
  }
  return null;
}

function assertSafeKey(key: string): string {
  if (!/^[A-Za-z0-9._-]{1,200}$/.test(key)) throw new Error("Session storage key is invalid.");
  return `rhsia.mobile.${key}`;
}

function manifestKey(baseKey: string): string {
  return `${baseKey}.manifest`;
}

function chunkKey(baseKey: string, slot: ChunkManifest["slot"], index: number): string {
  return `${baseKey}.${slot}.${index}`;
}
