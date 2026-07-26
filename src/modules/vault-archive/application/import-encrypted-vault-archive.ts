import type { EncryptedVaultImport, EncryptedVaultImportResult } from "../domain/encrypted-vault-import";

export interface EncryptedVaultImportRepository {
  import(ownerId: string, request: EncryptedVaultImport): Promise<EncryptedVaultImportResult>;
}

export function importEncryptedVaultArchive(ownerId: string, request: EncryptedVaultImport, repository: EncryptedVaultImportRepository): Promise<EncryptedVaultImportResult> {
  return repository.import(ownerId, request);
}
