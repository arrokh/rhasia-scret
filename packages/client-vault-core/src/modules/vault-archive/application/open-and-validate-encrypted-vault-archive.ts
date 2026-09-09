import { MAX_ENCRYPTED_VAULT_ARCHIVE_BYTES } from "../../../shared/application/archive-parameters";
import type { DecryptedAuthenticatorAccount } from "../../authenticator-account/application/account-payload-ports";
import type { VaultArchiveImportPort } from "./archive-ports";

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

export async function openAndValidateEncryptedVaultArchive(
  archiveKey: Uint8Array,
  archive: Uint8Array,
  ports: VaultArchiveImportPort,
): Promise<OpenedVaultArchive> {
  if (archiveKey.length !== 32) throw new VaultArchiveWorkflowError("invalidKeyLength");
  if (archive.length === 0 || archive.length > MAX_ENCRYPTED_VAULT_ARCHIVE_BYTES)
    throw new VaultArchiveWorkflowError("archiveTooLarge");
  const opened = await ports.openEncryptedVaultExport(archiveKey, archive);
  const accounts: DecryptedAuthenticatorAccount[] = [];
  try {
    for (const payload of opened.accounts) {
      try {
        accounts.push(ports.parseDecryptedAccountPayload(payload));
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

export function countDuplicateArchiveAccounts(
  imported: DecryptedAuthenticatorAccount[],
  existing: DecryptedAuthenticatorAccount[],
  ports: VaultArchiveImportPort,
): number {
  let count = 0;
  const accepted: DecryptedAuthenticatorAccount[] = [];
  for (const account of imported) {
    if (ports.isDuplicateAccount(account, existing) || ports.isDuplicateAccount(account, accepted)) count += 1;
    accepted.push(account);
  }
  return count;
}

export async function encryptVaultArchiveAccounts(
  destinationKey: Uint8Array,
  accounts: DecryptedAuthenticatorAccount[],
  vaultId: string | undefined,
  ports: VaultArchiveImportPort,
): Promise<Uint8Array[]> {
  const encrypted: Uint8Array[] = [];
  try {
    for (const account of accounts)
      encrypted.push(
        await ports.encryptAccountConfiguration(destinationKey, account, {
          purpose: "authenticator-account",
          payloadType: "totp-configuration",
          ...(vaultId ? { vaultId } : {}),
          keyVersion: 1,
        }),
      );
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
