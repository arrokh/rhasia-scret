import type { EncryptedOfflineVaultBundle } from "../domain/offline-vault-bundle";

export interface OfflineSyncBundleReader {
  readAuthorizedBundle(userId: string): Promise<EncryptedOfflineVaultBundle | null>;
}
