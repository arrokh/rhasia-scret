"use client";

import {
  encryptAccountConfiguration,
  isDuplicateAccount,
  parseDecryptedAccountPayload,
  type DecryptedAuthenticatorAccount
} from "@/modules/authenticator-account";
import { MAX_ENCRYPTED_VAULT_ARCHIVE_BYTES, openEncryptedVaultExport } from "@/modules/crypto";

export type VaultArchiveWorkflowErrorCode = "invalidKeyLength" | "archiveTooLarge";

export class VaultArchiveWorkflowError extends Error {
  public constructor(public readonly code: VaultArchiveWorkflowErrorCode) {
    super(`Vault archive workflow failed: ${code}.`);
    this.name = "VaultArchiveWorkflowError";
  }
}

export type OpenedVaultArchive = {
  vaultName: string;
  accounts: DecryptedAuthenticatorAccount[];
};

export async function openAndValidateEncryptedVaultArchive(archiveKey: Uint8Array, archive: Uint8Array): Promise<OpenedVaultArchive> {
  if (archiveKey.length !== 32) throw new VaultArchiveWorkflowError("invalidKeyLength");
  if (archive.length === 0 || archive.length > MAX_ENCRYPTED_VAULT_ARCHIVE_BYTES) throw new VaultArchiveWorkflowError("archiveTooLarge");
  const opened = await openEncryptedVaultExport(archiveKey, archive);
  const accounts: DecryptedAuthenticatorAccount[] = [];
  try {
    for (const payload of opened.accounts) {
      try {
        accounts.push(parseDecryptedAccountPayload(payload));
      } finally {
        payload.fill(0);
      }
    }
    return { vaultName: opened.vaultName, accounts };
  } catch (error) {
    for (const account of accounts) account.secret.fill(0);
    for (const payload of opened.accounts) payload.fill(0);
    throw error;
  }
}

export function countDuplicateArchiveAccounts(imported: DecryptedAuthenticatorAccount[], existing: DecryptedAuthenticatorAccount[]): number {
  let count = 0;
  const accepted: DecryptedAuthenticatorAccount[] = [];
  for (const account of imported) {
    if (isDuplicateAccount(account, existing) || isDuplicateAccount(account, accepted)) count += 1;
    accepted.push(account);
  }
  return count;
}

export async function encryptVaultArchiveAccounts(destinationKey: Uint8Array, accounts: DecryptedAuthenticatorAccount[], vaultId?: string): Promise<Uint8Array[]> {
  const encrypted: Uint8Array[] = [];
  try {
    for (const account of accounts) encrypted.push(await encryptAccountConfiguration(destinationKey, account, { purpose: "authenticator-account", payloadType: "totp-configuration", vaultId, keyVersion: 1 }));
    return encrypted;
  } catch (error) {
    for (const payload of encrypted) payload.fill(0);
    throw error;
  }
}

export function clearOpenedVaultArchive(archive: OpenedVaultArchive | null): void {
  if (!archive) return;
  for (const account of archive.accounts) account.secret.fill(0);
  archive.accounts.length = 0;
}
