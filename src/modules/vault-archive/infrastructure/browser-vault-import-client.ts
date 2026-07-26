"use client";

import { BrowserApiError, browserApiClient } from "@/shared/infrastructure/browser-api-client";

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
    if (error instanceof BrowserApiError && error.code === "destination_unavailable") throw new Error("Brankas tujuan tidak lagi tersedia. Tidak ada akun yang diimpor.");
    if (error instanceof BrowserApiError && error.code === "archive_import_conflict") throw new Error("Import bertabrakan dengan data yang sudah ada. Tidak ada perubahan sebagian yang disimpan.");
    if (error instanceof BrowserApiError && (error.code === "invalid_archive_import" || error.code === "archive_import_too_large")) throw new Error("Server menolak paket ciphertext import. Tidak ada perubahan yang disimpan.");
    throw new Error("Import tidak dapat dikonfirmasi oleh server. Coba lagi dengan pratinjau yang sama; pengenal stabil mencegah duplikasi.");
  }
}
