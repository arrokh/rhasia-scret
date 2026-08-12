import { Directory, File, Paths } from "expo-file-system";
import * as SecureStore from "expo-secure-store";
import type { EncryptedBlobPersistence, SecureKeyValueStorage } from "./encrypted-offline-vault-store";

const directory = new Directory(Paths.document, "encrypted-vault-data");
const snapshot = new File(directory, "offline-vaults.bin");
const temporarySnapshot = new File(directory, "offline-vaults.tmp");
const secureStoreOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export const nativeOfflineVaultPersistence: EncryptedBlobPersistence = {
  read: async () => snapshot.exists ? snapshot.bytes() : null,
  replace: async (bytes) => {
    if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
    if (temporarySnapshot.exists) temporarySnapshot.delete();
    temporarySnapshot.create();
    temporarySnapshot.write(bytes);
    await temporarySnapshot.move(snapshot, { overwrite: true });
  },
  remove: async () => {
    if (snapshot.exists) snapshot.delete();
    if (temporarySnapshot.exists) temporarySnapshot.delete();
  },
};

export const nativeOfflineVaultSecureKeys: SecureKeyValueStorage = {
  get: (key) => SecureStore.getItemAsync(key, secureStoreOptions),
  set: (key, value) => SecureStore.setItemAsync(key, value, secureStoreOptions),
  remove: (key) => SecureStore.deleteItemAsync(key, secureStoreOptions),
};
