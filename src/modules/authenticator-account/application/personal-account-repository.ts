import type { EncryptedAuthenticatorAccount } from "../domain/encrypted-account";

export type NewEncryptedAccount = {
  encryptedPayload: Uint8Array;
  encryptionVersion: number;
};

export interface PersonalAccountRepository {
  create(ownerId: string, vaultId: string, account: NewEncryptedAccount): Promise<EncryptedAuthenticatorAccount>;
  list(ownerId: string, vaultId: string): Promise<EncryptedAuthenticatorAccount[]>;
}
