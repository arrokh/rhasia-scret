"use client";

import {
  encryptAccountConfiguration,
  isDuplicateAccount,
  parseDecryptedAccountPayload,
  type DecryptedAuthenticatorAccount,
} from "@/modules/authenticator-account";
import { MAX_ENCRYPTED_VAULT_ARCHIVE_BYTES, openEncryptedVaultExport } from "@/modules/crypto";
import {
  clearOpenedVaultArchive,
  countDuplicateArchiveAccounts as countDuplicates,
  encryptVaultArchiveAccounts as encryptAccounts,
  openAndValidateEncryptedVaultArchive as openArchive,
  VaultArchiveWorkflowError,
  type OpenedVaultArchive,
  type VaultArchiveWorkflowErrorCode,
} from "@rhasia-scret/client-vault-core";
import type { VaultArchiveImportPort } from "@rhasia-scret/client-vault-core";

export { clearOpenedVaultArchive, VaultArchiveWorkflowError };
export type { OpenedVaultArchive, VaultArchiveWorkflowErrorCode };

const browserArchiveImportPort: VaultArchiveImportPort = {
  openEncryptedVaultExport,
  parseDecryptedAccountPayload,
  encryptAccountConfiguration,
  isDuplicateAccount,
};

export function openAndValidateEncryptedVaultArchive(
  archiveKey: Uint8Array,
  archive: Uint8Array,
): Promise<OpenedVaultArchive> {
  return openArchive(archiveKey, archive, browserArchiveImportPort);
}

export function countDuplicateArchiveAccounts(
  imported: DecryptedAuthenticatorAccount[],
  existing: DecryptedAuthenticatorAccount[],
): number {
  return countDuplicates(imported, existing, browserArchiveImportPort);
}

export function encryptVaultArchiveAccounts(
  destinationKey: Uint8Array,
  accounts: DecryptedAuthenticatorAccount[],
  vaultId?: string,
): Promise<Uint8Array[]> {
  return encryptAccounts(destinationKey, accounts, vaultId, browserArchiveImportPort);
}

export { MAX_ENCRYPTED_VAULT_ARCHIVE_BYTES };
