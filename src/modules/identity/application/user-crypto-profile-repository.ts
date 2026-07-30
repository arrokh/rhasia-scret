export type UserRootKeyRewrap = {
  vaultUnlockSalt: Uint8Array;
  wrappedUserRootKey: Uint8Array;
  encryptedPersonalVaultKey?: Uint8Array;
  encryptionVersion: number;
};

export type EncryptedUserCryptoProfile = {
  vaultUnlockSalt: Uint8Array;
  wrappedUserRootKey: Uint8Array;
  encryptedPersonalVaultKey: Uint8Array;
  encryptionVersion: number;
  userEncryptionPublicKey?: JsonWebKey;
  encryptedUserPrivateKey?: Uint8Array;
};

export type UserEncryptionIdentity = {
  publicKey: JsonWebKey;
  encryptedPrivateKey: Uint8Array;
  encryptionVersion: number;
};

export interface UserCryptoProfileRepository {
  get(userId: string): Promise<EncryptedUserCryptoProfile | null>;
  registerUserEncryptionIdentity(userId: string, identity: UserEncryptionIdentity): Promise<void>;
  rewrapUserRootKey(userId: string, rewrap: UserRootKeyRewrap): Promise<void>;
}
