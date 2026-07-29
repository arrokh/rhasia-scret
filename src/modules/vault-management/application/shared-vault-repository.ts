import type { Vault } from "../domain/vault";

export type NewSharedVault = {
  id?: string;
  encryptedName: Uint8Array;
  encryptionVersion: number;
  encryptedOwnerVaultKey: Uint8Array;
};

export interface SharedVaultRepository {
  create(ownerId: string, vault: NewSharedVault): Promise<Vault>;
  rename(ownerId: string, vaultId: string, encryptedName: Uint8Array, encryptionVersion: number): Promise<boolean>;
}
