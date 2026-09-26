"use client";

import { BrowserApiError, browserApiClient } from "@/shared/infrastructure/browser-api-client";
import type { PortableJsonWebKey } from "@rhasia-scret/client-vault-core";

export type VaultImportClientErrorCode =
  "clientDestinationUnavailable" | "clientConflict" | "clientInvalidPayload" | "clientTimeout" | "clientServerError";

export class VaultImportClientError extends Error {
  public constructor(public readonly code: VaultImportClientErrorCode) {
    super(`Vault import request failed: ${code}.`);
    this.name = "VaultImportClientError";
  }
}

export type BrowserEncryptedVaultImportRequest = {
  destination:
    | { kind: "EXISTING"; vaultId: string; vaultType: "PERSONAL" }
    | { kind: "EXISTING"; vaultId: string; vaultType: "SHARED"; expectedKeyVersion: number }
    | {
        kind: "NEW_SHARED";
        vaultId: string;
        encryptedName: string;
        encryptedOwnerVaultKey: string;
        expectedOwnerPublicKey: PortableJsonWebKey;
        encryptionVersion: 1;
      };
  accounts: Array<{ id: string; encryptedPayload: string; encryptionVersion: 1 }>;
};

export type BrowserEncryptedVaultImportResult = {
  vaultId: string;
  accountIds: string[];
  vaultCreated: boolean;
  replayed: boolean;
};

export async function uploadEncryptedVaultImport(
  request: BrowserEncryptedVaultImportRequest,
): Promise<BrowserEncryptedVaultImportResult> {
  try {
    return await browserApiClient.postJson("/api/v1/vault-imports", request, { signal: AbortSignal.timeout(60_000) });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError"))
      throw new VaultImportClientError("clientTimeout");
    if (error instanceof BrowserApiError && error.code === "destination_unavailable")
      throw new VaultImportClientError("clientDestinationUnavailable");
    if (error instanceof BrowserApiError && error.code === "archive_import_conflict")
      throw new VaultImportClientError("clientConflict");
    if (
      error instanceof BrowserApiError &&
      (error.code === "invalid_archive_import" || error.code === "archive_import_too_large")
    )
      throw new VaultImportClientError("clientInvalidPayload");
    throw new VaultImportClientError("clientServerError");
  }
}
