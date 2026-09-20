import type { EncryptedOfflineVaultBundle } from "@rhasia-scret/client-vault-core/modules/sync/domain/offline-vault-bundle";

export interface OfflineSyncBundleReader {
  readAuthorizedBundle(userId: string): Promise<EncryptedOfflineVaultBundle | null>;
}
