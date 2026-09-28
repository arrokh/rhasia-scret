import type {
  EncryptedPayloadMigration,
  EncryptedPayloadMigrationResult,
} from "@api/shared/application/encrypted-payload-migration";
import type { Vault } from "../domain/vault";

export interface PersonalVaultRepository {
  ensureForOwner(ownerId: string): Promise<Vault>;
  migrateName(
    ownerId: string,
    vaultId: string,
    expectedKeyVersion: number,
    migration: EncryptedPayloadMigration,
  ): Promise<EncryptedPayloadMigrationResult>;
}
