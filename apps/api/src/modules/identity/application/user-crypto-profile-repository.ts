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

export type UserEncryptionPrivateKeyMigration = {
  expectedEnvelopeVersion: 1;
  replacementEnvelopeVersion: 2;
  userEncryptionKeyVersion: number;
  expectedCiphertextDigest: string;
  replacementCiphertextDigest: string;
  encryptedPrivateKey: Uint8Array;
  operationId: string;
};

export type UserEncryptionPrivateKeyMigrationResult = "committed" | "already-committed" | "conflict";

export type UserCryptoProfileWrapperMigration = {
  expectedCiphertext: Uint8Array;
  replacementCiphertext: Uint8Array;
};

export type UserCryptoProfileMigration = {
  wrappedUserRootKey?: UserCryptoProfileWrapperMigration;
  encryptedPersonalVaultKey?: UserCryptoProfileWrapperMigration;
};

export type UserCryptoProfileMigrationResult = "committed" | "already-committed" | "conflict";

export interface UserCryptoProfileRepository {
  get(userId: string): Promise<EncryptedUserCryptoProfile | null>;
  registerUserEncryptionIdentity(userId: string, identity: UserEncryptionIdentity): Promise<boolean>;
  migrateUserEncryptionPrivateKey(
    userId: string,
    migration: UserEncryptionPrivateKeyMigration,
  ): Promise<UserEncryptionPrivateKeyMigrationResult>;
  migrateUserCryptoProfile(
    userId: string,
    migration: UserCryptoProfileMigration,
  ): Promise<UserCryptoProfileMigrationResult>;
  rewrapUserRootKey(userId: string, rewrap: UserRootKeyRewrap): Promise<void>;
}
