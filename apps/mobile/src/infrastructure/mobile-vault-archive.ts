import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { createAuthenticatorAccountPayloadPort } from "@rhasia-scret/client-vault-core";
import type { UnlockedVault, UnlockedVaultWorkspace } from "@rhasia-scret/client-vault-core";
import { createVaultArchiveProtocol } from "@rhasia-scret/client-vault-core";
import { openAndValidateEncryptedVaultArchive, type OpenedVaultArchive } from "@rhasia-scret/client-vault-core";
import {
  clearPreparedVaultArchive,
  prepareEncryptedVaultArchive,
  type PreparedVaultArchive,
} from "@rhasia-scret/client-vault-core";
import { MAX_ENCRYPTED_VAULT_ARCHIVE_BYTES } from "@rhasia-scret/client-vault-core";
import { base64ToBytes, bytesToBase64 } from "@rhasia-scret/client-vault-core";
import type { AuthenticatedTransport } from "@rhasia-scret/client-vault-core";
import { nativeClientCrypto } from "./native-client-crypto";

const accountPayloads = createAuthenticatorAccountPayloadPort(nativeClientCrypto);
const archiveProtocol = createVaultArchiveProtocol(nativeClientCrypto);
const archivePort = {
  generateSymmetricKey: nativeClientCrypto.generateSymmetricKey,
  serializeDecryptedAccountPayload: accountPayloads.serializeDecryptedAccountPayload,
  createEncryptedVaultArchive: archiveProtocol.createEncryptedVaultArchive,
};
const importPort = {
  openEncryptedVaultExport: archiveProtocol.openEncryptedVaultExport,
  parseDecryptedAccountPayload: accountPayloads.parseDecryptedAccountPayload,
  encryptAccountConfiguration: accountPayloads.encryptAccountConfiguration,
  isDuplicateAccount: accountPayloads.isDuplicateAccount,
};

export async function prepareMobileVaultArchive(
  workspace: UnlockedVaultWorkspace,
  vault: UnlockedVault,
  transport: AuthenticatedTransport,
): Promise<PreparedVaultArchive> {
  const prepared = await prepareEncryptedVaultArchive(
    {
      vault,
      accounts: workspace.accounts.filter((account) => account.vaultId === vault.id),
    },
    archivePort,
  );
  try {
    const response = await transport.request({
      url: `/api/vaults/${encodeURIComponent(vault.id)}/archive-exports`,
      method: "POST",
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Encrypted Vault archive audit could not be recorded.");
    return prepared;
  } catch (error) {
    clearPreparedVaultArchive(prepared);
    throw error;
  }
}

export async function sharePreparedMobileVaultArchive(prepared: PreparedVaultArchive): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new Error("Native sharing is unavailable.");
  const file = new File(Paths.cache, prepared.filename);
  try {
    file.create({ overwrite: true });
    file.write(prepared.archive);
    await Sharing.shareAsync(file.uri, { mimeType: "application/octet-stream", dialogTitle: prepared.filename });
  } finally {
    if (file.exists) file.delete();
  }
}

export async function pickAndOpenMobileVaultArchive(keyMaterial: string): Promise<OpenedVaultArchive | null> {
  const key = parseArchiveKey(keyMaterial);
  let archive: Uint8Array | undefined;
  try {
    const picked = await File.pickFileAsync({
      mimeTypes: ["application/octet-stream", "application/zip"],
      multipleFiles: false,
    });
    if (picked.canceled) return null;
    if (picked.result.size <= 0 || picked.result.size > MAX_ENCRYPTED_VAULT_ARCHIVE_BYTES)
      throw new Error("Encrypted Vault archive is too large.");
    archive = await picked.result.bytes();
    return await openAndValidateEncryptedVaultArchive(key, archive, importPort);
  } finally {
    key.fill(0);
    archive?.fill(0);
  }
}

export async function importOpenedArchiveIntoVault(
  opened: OpenedVaultArchive,
  destination: UnlockedVault,
  transport: AuthenticatedTransport,
): Promise<void> {
  if (!destination.effectiveAccountPermissions.permissions.canAddAccounts)
    throw new Error("Vault does not permit account imports.");
  const encryptedPayloads: Uint8Array[] = [];
  try {
    for (const account of opened.accounts) {
      encryptedPayloads.push(
        await accountPayloads.encryptAccountConfiguration(destination.key, account, {
          purpose: "authenticator-account",
          payloadType: "totp-configuration",
          vaultId: destination.id,
          keyVersion: 1,
        }),
      );
    }
    const accountIds = encryptedPayloads.map(() => randomUuid());
    const response = await transport.request({
      url: "/api/vault-imports",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        destination: { kind: "EXISTING", vaultId: destination.id, vaultType: destination.type },
        accounts: encryptedPayloads.map((encryptedPayload, index) => ({
          id: accountIds[index],
          encryptedPayload: bytesToBase64(encryptedPayload),
          encryptionVersion: 1,
        })),
      }),
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Encrypted Vault archive import failed.");
    const result = await response.json<unknown>();
    if (!validImportResult(result, destination.id, accountIds))
      throw new Error("Encrypted Vault archive import response is invalid.");
  } finally {
    for (const payload of encryptedPayloads) payload.fill(0);
  }
}

function parseArchiveKey(value: string): Uint8Array {
  const key = base64ToBytes(value.trim());
  if (key.length !== 32) {
    key.fill(0);
    throw new Error("Encrypted Vault archive key is invalid.");
  }
  return key;
}

function randomUuid(): string {
  const bytes = nativeClientCrypto.randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  bytes.fill(0);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function validImportResult(value: unknown, vaultId: string, accountIds: string[]): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    record.vaultId === vaultId &&
    Array.isArray(record.accountIds) &&
    record.accountIds.join(",") === accountIds.join(",") &&
    record.vaultCreated === false &&
    typeof record.replayed === "boolean"
  );
}
