import type { EncryptedVaultImport, EncryptedVaultImportResult } from "../domain/encrypted-vault-import";

export interface EncryptedVaultImportRepository {
  import(actorUserId: string, request: EncryptedVaultImport): Promise<EncryptedVaultImportResult>;
}

export function importEncryptedVaultArchive(
  actorUserId: string,
  request: EncryptedVaultImport,
  repository: EncryptedVaultImportRepository,
): Promise<EncryptedVaultImportResult> {
  return repository.import(actorUserId, request);
}
