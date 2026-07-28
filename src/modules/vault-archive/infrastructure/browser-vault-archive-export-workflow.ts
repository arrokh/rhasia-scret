"use client";

import { serializeDecryptedAccountPayload, type WorkspaceAuthenticatorAccount } from "@/modules/authenticator-account";
import { createEncryptedVaultArchive, generateSymmetricKey, MAX_VAULT_ARCHIVE_ACCOUNTS } from "@/modules/crypto";
import { bytesToBase64 } from "@/shared/infrastructure/browser-base64";

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
  vault: { id: string; name: string; type: "PERSONAL" | "SHARED"; role: "OWNER" | "VIEWER" },
  accounts: WorkspaceAuthenticatorAccount[],
  now = new Date()
): Promise<PreparedVaultArchive> {
  if (vault.role !== "OWNER") throw new VaultArchiveExportError("owner_required");
  if (accounts.length > MAX_VAULT_ARCHIVE_ACCOUNTS) throw new VaultArchiveExportError("too_large");
  const archiveKey = generateSymmetricKey();
  const plaintexts: Uint8Array[] = [];
  try {
    for (const account of accounts) {
      if (account.vaultId !== vault.id) throw new VaultArchiveExportError("account_mismatch");
      plaintexts.push(serializeDecryptedAccountPayload(account));
    }
    const archive = await createEncryptedVaultArchive(archiveKey, vault.name, plaintexts);
    return {
      vaultId: vault.id,
      archive,
      key: archiveKey,
      keyMaterial: bytesToBase64(archiveKey),
      filename: `rhasia-vault-${now.toISOString().slice(0, 10)}.rhasia-vault`
    };
  } catch (error) {
    archiveKey.fill(0);
    throw error;
  } finally {
    for (const plaintext of plaintexts) plaintext.fill(0);
  }
}

export function downloadPreparedVaultArchive(prepared: PreparedVaultArchive): void {
  const blob = new Blob([prepared.archive.slice()], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = prepared.filename;
    anchor.rel = "noopener";
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function clearPreparedVaultArchive(prepared: PreparedVaultArchive | null): void {
  if (!prepared) return;
  prepared.archive.fill(0);
  prepared.key.fill(0);
  prepared.keyMaterial = "";
}
