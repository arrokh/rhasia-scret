export type UserRootKeyRewrap = {
  vaultUnlockSalt: Uint8Array;
  wrappedUserRootKey: Uint8Array;
  encryptionVersion: number;
};

export interface UserCryptoProfileRepository {
  rewrapUserRootKey(userId: string, rewrap: UserRootKeyRewrap): Promise<void>;
}
