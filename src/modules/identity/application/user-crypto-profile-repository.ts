export type UserRootKeyRewrap = {
  vaultUnlockSalt: Uint8Array;
  wrappedUserRootKey: Uint8Array;
  encryptionVersion: number;
};

export type EncryptedUserCryptoProfile = {
  vaultUnlockSalt: Uint8Array;
  wrappedUserRootKey: Uint8Array;
  encryptedPersonalVaultKey: Uint8Array;
  encryptionVersion: number;
};

export interface UserCryptoProfileRepository {
  get(userId: string): Promise<EncryptedUserCryptoProfile | null>;
  rewrapUserRootKey(userId: string, rewrap: UserRootKeyRewrap): Promise<void>;
}
