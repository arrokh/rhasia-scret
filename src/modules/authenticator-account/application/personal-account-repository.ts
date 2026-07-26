import type { EncryptedAuthenticatorAccount } from "../domain/encrypted-account";

export type NewEncryptedAccount = {
  encryptedPayload: Uint8Array;
  encryptionVersion: number;
};

export interface PersonalAccountRepository {
  create(ownerId: string, vaultId: string, account: NewEncryptedAccount): Promise<EncryptedAuthenticatorAccount>;
  list(ownerId: string, vaultId: string): Promise<EncryptedAuthenticatorAccount[]>;
  update(ownerId: string, vaultId: string, accountId: string, expectedRevision: number, account: NewEncryptedAccount): Promise<EncryptedAuthenticatorAccount | null>;
  delete(ownerId: string, vaultId: string, accountId: string, expectedRevision: number): Promise<boolean>;
  restore(ownerId: string, vaultId: string, accountId: string): Promise<boolean>;
}
