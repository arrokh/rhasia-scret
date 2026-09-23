import type { EncryptedOnlineWorkspaceBundle } from "@rhasia-scret/client-vault-core";

export interface OfflineSyncBundleReader {
  readAuthorizedBundle(userId: string): Promise<EncryptedOnlineWorkspaceBundle | null>;
}
