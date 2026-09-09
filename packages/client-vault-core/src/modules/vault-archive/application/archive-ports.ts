import type { DownloadPort } from "../../../shared/application/platform-ports";
import type { DecryptedAuthenticatorAccount } from "../../authenticator-account/application/account-payload-ports";
import type { WorkspaceAuthenticatorAccount } from "../../authenticator-account/application/vault-workspace";

export type EncryptedArchivePayload = {
  archive: Uint8Array;
  key: Uint8Array;
  keyMaterial: string;
  filename: string;
};

export type ArchiveDownloadPort = DownloadPort;

export interface VaultArchiveCryptoPort {
  generateSymmetricKey(): Uint8Array;
  serializeDecryptedAccountPayload(configuration: DecryptedAuthenticatorAccount): Uint8Array;
  createEncryptedVaultArchive(
    archiveKey: Uint8Array,
    vaultName: string,
    accountPlaintexts: Uint8Array[],
  ): Promise<Uint8Array>;
}

export interface VaultArchiveImportPort {
  openEncryptedVaultExport(
    archiveKey: Uint8Array,
    archive: Uint8Array,
  ): Promise<{ vaultName: string; accounts: Uint8Array[] }>;
  parseDecryptedAccountPayload(plaintext: Uint8Array): DecryptedAuthenticatorAccount;
  encryptAccountConfiguration(
    destinationKey: Uint8Array,
    account: DecryptedAuthenticatorAccount,
    context: { purpose: "authenticator-account"; payloadType: "totp-configuration"; vaultId?: string; keyVersion: 1 },
  ): Promise<Uint8Array>;
  isDuplicateAccount(candidate: DecryptedAuthenticatorAccount, accounts: DecryptedAuthenticatorAccount[]): boolean;
}

export type VaultArchiveExportInput = {
  vault: { id: string; name: string; type: "PERSONAL" | "SHARED"; role: "OWNER" | "VIEWER" };
  accounts: WorkspaceAuthenticatorAccount[];
  now?: Date;
};
