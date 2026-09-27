export type UserEncryptionIdentityRotationSnapshot = {
  publicKey: JsonWebKey;
  encryptedPrivateKey: Uint8Array;
  encryptionVersion: number;
  memberships: Array<{
    vaultId: string;
    ownerId: string;
    encryptedVaultKey: Uint8Array;
    keyVersion: number;
  }>;
};

export type UserEncryptionIdentityRotation = {
  expectedPublicKey: JsonWebKey;
  expectedEncryptedPrivateKey: Uint8Array;
  expectedEncryptionVersion: number;
  publicKey: JsonWebKey;
  encryptedPrivateKey: Uint8Array;
  encryptionVersion: number;
  memberships: Array<{
    vaultId: string;
    expectedKeyVersion: number;
    expectedEncryptedVaultKey: Uint8Array;
    encryptedVaultKey: Uint8Array;
  }>;
};

export interface UserEncryptionIdentityRotationRepository {
  snapshot(userId: string): Promise<UserEncryptionIdentityRotationSnapshot | null>;
  rotate(userId: string, rotation: UserEncryptionIdentityRotation): Promise<boolean>;
}
