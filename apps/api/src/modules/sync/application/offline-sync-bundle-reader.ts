import type { EncryptedOnlineWorkspaceBundle } from "@rhasia-scret/client-vault-core/modules/sync/domain/offline-vault-bundle";

export interface OfflineSyncBundleReader {
  readAuthorizedBundle(userId: string): Promise<EncryptedOnlineWorkspaceBundle | null>;
}
