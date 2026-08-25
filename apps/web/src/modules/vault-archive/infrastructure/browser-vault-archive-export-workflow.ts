"use client";

import { createEncryptedVaultArchive, generateSymmetricKey } from "@/modules/crypto";
import { browserDownload } from "@/shared/infrastructure/browser-platform-ports";
import {
  clearPreparedVaultArchive,
  prepareEncryptedVaultArchive as prepareArchive,
  VaultArchiveExportError,
  type PreparedVaultArchive,
  type VaultArchiveExportErrorCode
} from "@rhasia-scret/client-vault-core";
import { serializeDecryptedAccountPayload } from "@/modules/authenticator-account";
import type { WorkspaceAuthenticatorAccount } from "@/modules/sync";

export { VaultArchiveExportError, clearPreparedVaultArchive };
export type { PreparedVaultArchive, VaultArchiveExportErrorCode };

const browserArchiveCrypto = {
  generateSymmetricKey,
  serializeDecryptedAccountPayload,
  createEncryptedVaultArchive
};

export async function prepareEncryptedVaultArchive(
  vault: { id: string; name: string; type: "PERSONAL" | "SHARED"; role: "OWNER" | "VIEWER" },
  accounts: WorkspaceAuthenticatorAccount[],
  now = new Date()
): Promise<PreparedVaultArchive> {
  return prepareArchive({ vault, accounts, now }, browserArchiveCrypto);
}

export function downloadPreparedVaultArchive(prepared: PreparedVaultArchive): void {
  browserDownload.download({ bytes: prepared.archive, filename: prepared.filename, mediaType: "application/octet-stream" });
}
