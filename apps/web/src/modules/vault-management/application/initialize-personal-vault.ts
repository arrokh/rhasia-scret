export type PersonalVaultInitialization = {
  vaultUnlockSalt: Uint8Array;
  wrappedUserRootKey: Uint8Array;
  encryptedPersonalVaultKey: Uint8Array;
  encryptedVaultName: Uint8Array;
  encryptionVersion: number;
};

export interface PersonalVaultInitializer {
  initialize(ownerId: string, initialization: PersonalVaultInitialization): Promise<void>;
}

export async function initializePersonalVault(
  ownerId: string,
  initialization: PersonalVaultInitialization,
  vaults: PersonalVaultInitializer
): Promise<void> {
  if (!ownerId) throw new Error("An application user is required to initialize a Personal Vault.");
  if (initialization.encryptionVersion !== 1) throw new Error("Unsupported encryption version.");
  await vaults.initialize(ownerId, initialization);
}
