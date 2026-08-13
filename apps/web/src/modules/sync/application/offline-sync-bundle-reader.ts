import type { EncryptedOfflineVaultBundle } from "@rhasia-scret/client-vault-core";

export interface OfflineSyncBundleReader {
  readAuthorizedBundle(userId: string): Promise<EncryptedOfflineVaultBundle | null>;
}
