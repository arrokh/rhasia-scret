import { PrismaEncryptedVaultImportRepository } from "./infrastructure/prisma-encrypted-vault-import-repository";
import type { PrismaDatabase } from "@api/shared/infrastructure/prisma-client";

export {
  importEncryptedVaultArchive,
  type EncryptedVaultImportRepository,
} from "./application/import-encrypted-vault-archive";
export {
  MAX_IMPORTED_CIPHERTEXT_BYTES,
  MAX_VAULT_ARCHIVE_IMPORT_ACCOUNTS,
  MAX_VAULT_ARCHIVE_IMPORT_REQUEST_BYTES,
} from "./domain/encrypted-vault-import";

export function createEncryptedVaultImportRepository(database: PrismaDatabase): PrismaEncryptedVaultImportRepository {
  return new PrismaEncryptedVaultImportRepository(database);
}
