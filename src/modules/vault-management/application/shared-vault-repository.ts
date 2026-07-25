import type { Vault } from "../domain/vault";

export type NewSharedVault = {
  encryptedName: Uint8Array;
  encryptionVersion: number;
  encryptedOwnerVaultKey: Uint8Array;
};

export interface SharedVaultRepository {
  create(ownerId: string, vault: NewSharedVault): Promise<Vault>;
}
