import type {
  EncryptedPayloadMigration,
  EncryptedPayloadMigrationResult,
} from "@api/shared/application/encrypted-payload-migration";
import type { EncryptedAuthenticatorAccount } from "../domain/encrypted-account";

export type NewEncryptedAccount = {
  encryptedPayload: Uint8Array;
  encryptionVersion: number;
  source?: "LOCAL_VAULT_COPY";
};

export interface PersonalAccountRepository {
  create(ownerId: string, vaultId: string, account: NewEncryptedAccount): Promise<EncryptedAuthenticatorAccount>;
  list(ownerId: string, vaultId: string): Promise<EncryptedAuthenticatorAccount[]>;
  migratePayload(
    ownerId: string,
    vaultId: string,
    accountId: string,
    expectedRevision: number,
    expectedKeyVersion: number,
    migration: EncryptedPayloadMigration,
  ): Promise<EncryptedPayloadMigrationResult>;
  update(
    ownerId: string,
    vaultId: string,
    accountId: string,
    expectedRevision: number,
    account: NewEncryptedAccount,
  ): Promise<EncryptedAuthenticatorAccount | null>;
  delete(ownerId: string, vaultId: string, accountId: string, expectedRevision: number): Promise<boolean>;
  restore(ownerId: string, vaultId: string, accountId: string): Promise<boolean>;
}
