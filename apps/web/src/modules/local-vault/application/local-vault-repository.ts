import type { LocalVaultRecord } from "../domain/local-vault-record";

export interface LocalVaultRepository {
  create(record: LocalVaultRecord): Promise<void>;
  read(): Promise<LocalVaultRecord | null>;
  readArchiveExportAt(profileId: string): Promise<string | null>;
  clearOrphanedArchiveExportMarker(): Promise<void>;
  recordArchiveExportAt(profileId: string, exportedAt: string): Promise<void>;
  replace(record: LocalVaultRecord): Promise<void>;
  clear(): Promise<void>;
}
