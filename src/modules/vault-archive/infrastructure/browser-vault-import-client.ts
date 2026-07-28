"use client";

import { BrowserApiError, browserApiClient } from "@/shared/infrastructure/browser-api-client";

export type VaultImportClientErrorCode = "clientDestinationUnavailable" | "clientConflict" | "clientInvalidPayload" | "clientServerError";

export class VaultImportClientError extends Error {
  public constructor(public readonly code: VaultImportClientErrorCode) {
    super(`Vault import request failed: ${code}.`);
    this.name = "VaultImportClientError";
  }
}

export type BrowserEncryptedVaultImportRequest = {
  destination:
    | { kind: "EXISTING"; vaultId: string; vaultType: "PERSONAL" | "SHARED" }
    | { kind: "NEW_SHARED"; vaultId: string; encryptedName: string; encryptedOwnerVaultKey: string; encryptionVersion: 1 };
  accounts: Array<{ id: string; encryptedPayload: string; encryptionVersion: 1 }>;
};

export type BrowserEncryptedVaultImportResult = {
  vaultId: string;
  accountIds: string[];
  vaultCreated: boolean;
  replayed: boolean;
};

export async function uploadEncryptedVaultImport(request: BrowserEncryptedVaultImportRequest): Promise<BrowserEncryptedVaultImportResult> {
  try {
    return await browserApiClient.postJson("/api/vault-imports", request);
  } catch (error) {
    if (error instanceof BrowserApiError && error.code === "destination_unavailable") throw new VaultImportClientError("clientDestinationUnavailable");
    if (error instanceof BrowserApiError && error.code === "archive_import_conflict") throw new VaultImportClientError("clientConflict");
    if (error instanceof BrowserApiError && (error.code === "invalid_archive_import" || error.code === "archive_import_too_large")) throw new VaultImportClientError("clientInvalidPayload");
    throw new VaultImportClientError("clientServerError");
  }
}
