import type { EffectiveSharedVaultAccountPermissions } from "@rhasia-scret/client-vault-core/modules/vault-membership/domain/shared-vault-account-permissions";
import type {
  EncryptedPayloadMigration,
  EncryptedPayloadMigrationResult,
} from "@api/shared/application/encrypted-payload-migration";

export type SharedVaultAccess = {
  vaultId: string;
  role: "OWNER" | "VIEWER";
  effectiveAccountPermissions: EffectiveSharedVaultAccountPermissions;
  encryptedName: Uint8Array;
  encryptionVersion: number;
  encryptedVaultKey: Uint8Array;
  keyVersion: number;
  accounts: Array<{ id: string; encryptedPayload: Uint8Array; encryptionVersion: number; revision: number }>;
};

export interface SharedVaultAccessRepository {
  getForMember(userId: string, vaultId: string): Promise<SharedVaultAccess | null>;
  listForMember(userId: string): Promise<SharedVaultAccess[]>;
  migrateKeyWrap(
    userId: string,
    vaultId: string,
    expectedKeyVersion: number,
    migration: EncryptedPayloadMigration,
  ): Promise<EncryptedPayloadMigrationResult>;
}
