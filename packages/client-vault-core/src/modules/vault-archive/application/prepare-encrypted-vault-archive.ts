import type { WorkspaceAuthenticatorAccount } from "../../authenticator-account/application/vault-workspace";
import { MAX_VAULT_ARCHIVE_ACCOUNTS } from "../../../shared/application/archive-parameters";
import { bytesToBase64 } from "../../../shared/application/base64";
import type { VaultArchiveCryptoPort, VaultArchiveExportInput } from "./archive-ports";

export type VaultArchiveExportErrorCode = "owner_required" | "too_large" | "account_mismatch";

export class VaultArchiveExportError extends Error {
  public constructor(public readonly code: VaultArchiveExportErrorCode) {
    super(code);
    this.name = "VaultArchiveExportError";
  }
}

export type PreparedVaultArchive = {
  vaultId: string;
  archive: Uint8Array;
  key: Uint8Array;
  keyMaterial: string;
  filename: string;
};

export async function prepareEncryptedVaultArchive(
  input: VaultArchiveExportInput,
  cryptoPort: VaultArchiveCryptoPort,
): Promise<PreparedVaultArchive> {
  const { vault, accounts, now = new Date() } = input;
  if (vault.role !== "OWNER") throw new VaultArchiveExportError("owner_required");
  if (accounts.length > MAX_VAULT_ARCHIVE_ACCOUNTS) throw new VaultArchiveExportError("too_large");
  const archiveKey = cryptoPort.generateSymmetricKey();
  const plaintexts: Uint8Array[] = [];
  try {
    for (const account of accounts) {
      if (account.vaultId !== vault.id) throw new VaultArchiveExportError("account_mismatch");
      plaintexts.push(cryptoPort.serializeDecryptedAccountPayload(account));
    }
    const archive = await cryptoPort.createEncryptedVaultArchive(archiveKey, vault.name, plaintexts);
    return {
      vaultId: vault.id,
      archive,
      key: archiveKey,
      keyMaterial: bytesToBase64(archiveKey),
      filename: `rhasia-vault-${now.toISOString().slice(0, 10)}.rhasia-vault`,
    };
  } catch (error) {
    archiveKey.fill(0);
    throw error;
  } finally {
    for (const plaintext of plaintexts) plaintext.fill(0);
  }
}

export function clearPreparedVaultArchive(prepared: PreparedVaultArchive | null): void {
  if (!prepared) return;
  prepared.archive.fill(0);
  prepared.key.fill(0);
  prepared.keyMaterial = "";
}

export type { WorkspaceAuthenticatorAccount };
