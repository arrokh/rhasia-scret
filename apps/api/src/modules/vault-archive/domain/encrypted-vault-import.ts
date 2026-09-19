export const VAULT_ARCHIVE_ENCRYPTION_VERSION = 1 as const;
export const MAX_VAULT_ARCHIVE_IMPORT_ACCOUNTS = 500;
export const MAX_VAULT_ARCHIVE_IMPORT_REQUEST_BYTES = 8 * 1024 * 1024;
export const MAX_IMPORTED_CIPHERTEXT_BYTES = 16 * 1024 + 29;

export type EncryptedImportedAccount = {
  id: string;
  encryptedPayload: Uint8Array;
  encryptionVersion: 1;
};

export type ExistingVaultImportDestination = {
  kind: "EXISTING";
  vaultId: string;
  vaultType: "PERSONAL" | "SHARED";
};

export type NewSharedVaultImportDestination = {
  kind: "NEW_SHARED";
  vaultId: string;
  encryptedName: Uint8Array;
  encryptedOwnerVaultKey: Uint8Array;
  encryptionVersion: 1;
};

export type EncryptedVaultImport = {
  destination: ExistingVaultImportDestination | NewSharedVaultImportDestination;
  accounts: EncryptedImportedAccount[];
};

export function hasDuplicateImportedAccountIds(accounts: readonly EncryptedImportedAccount[]): boolean {
  const identifiers = new Set<string>();
  for (const account of accounts) {
    if (identifiers.has(account.id)) return true;
    identifiers.add(account.id);
  }
  return false;
}

export type EncryptedVaultImportResult =
  | { status: "IMPORTED" | "REPLAYED"; vaultId: string; accountIds: string[]; vaultCreated: boolean }
  | { status: "DESTINATION_UNAVAILABLE" }
  | { status: "CONFLICT" };
