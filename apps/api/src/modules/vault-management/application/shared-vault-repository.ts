import type {
  EncryptedPayloadMigration,
  EncryptedPayloadMigrationResult,
} from "@api/shared/application/encrypted-payload-migration";
import type { Vault } from "../domain/vault";

export type NewSharedVault = {
  id?: string;
  encryptedName: Uint8Array;
  encryptionVersion: number;
  encryptedOwnerVaultKey: Uint8Array;
  expectedOwnerPublicKey: JsonWebKey;
};

export class SharedVaultKeyVersionConflictError extends Error {}
export class SharedVaultIdentityConflictError extends Error {}

export interface SharedVaultRepository {
  create(ownerId: string, vault: NewSharedVault): Promise<Vault>;
  rename(
    ownerId: string,
    vaultId: string,
    encryptedName: Uint8Array,
    encryptionVersion: number,
    expectedKeyVersion: number,
  ): Promise<boolean>;
  migrateName(
    actorUserId: string,
    vaultId: string,
    expectedKeyVersion: number,
    migration: EncryptedPayloadMigration,
  ): Promise<EncryptedPayloadMigrationResult>;
}
