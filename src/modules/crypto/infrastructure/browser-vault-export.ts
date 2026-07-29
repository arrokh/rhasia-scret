"use client";

import { base64ToBytes, bytesToBase64 } from "@/shared/infrastructure/browser-base64";
import { decryptPayloadWithContext, deserializeEncryptedEnvelope, encryptPayloadWithContext, serializeEncryptedEnvelope, type CryptoEnvelopeContext } from "./browser-crypto-envelope";

const FORMAT_VERSION = 1;
export const MAX_ENCRYPTED_VAULT_ARCHIVE_BYTES = 5 * 1024 * 1024;
export const MAX_VAULT_ARCHIVE_ACCOUNTS = 500;
const MAX_VAULT_NAME_LENGTH = 120;
const MAX_ARCHIVED_ACCOUNT_BYTES = 16 * 1024;

type VaultExportPayload = { version: 1; vaultName: string; accounts: string[] };

/** Produces a portable encrypted archive from normalized plaintext held only in browser memory. */
export async function createEncryptedVaultArchive(archiveKey: Uint8Array, vaultName: string, accountPlaintexts: Uint8Array[]): Promise<Uint8Array> {
  if (archiveKey.length !== 32) throw new Error("Encrypted vault export key is invalid.");
  const normalizedName = vaultName.trim();
  if (!normalizedName || normalizedName.length > MAX_VAULT_NAME_LENGTH) throw new Error("Encrypted vault export is invalid.");
  if (accountPlaintexts.length > MAX_VAULT_ARCHIVE_ACCOUNTS) throw new Error("Encrypted vault export is too large.");
  const accounts = accountPlaintexts.map((plaintext) => {
    if (plaintext.length === 0 || plaintext.length > MAX_ARCHIVED_ACCOUNT_BYTES) throw new Error("Encrypted vault export is too large.");
    return bytesToBase64(plaintext);
  });
  const plaintext = new TextEncoder().encode(JSON.stringify({ version: FORMAT_VERSION, vaultName: normalizedName, accounts } satisfies VaultExportPayload));
  try {
    if (plaintext.length > MAX_ENCRYPTED_VAULT_ARCHIVE_BYTES - 29) throw new Error("Encrypted vault export is too large.");
    return serializeEncryptedEnvelope(await encryptPayloadWithContext(archiveKey, plaintext, { purpose: "encrypted-archive", payloadType: "vault-archive", archiveVersion: FORMAT_VERSION }));
  } finally {
    plaintext.fill(0);
  }
}

/** Produces the same archive from existing Vault ciphertext without exposing plaintext to callers. */
export async function createEncryptedVaultExport(vaultKey: Uint8Array, archiveKey: Uint8Array, encryptedName: Uint8Array, encryptedAccounts: Uint8Array[], context: Pick<CryptoEnvelopeContext, "vaultId" | "profileId"> = {}, accountIds: string[] = []): Promise<Uint8Array> {
  if (encryptedAccounts.length > MAX_VAULT_ARCHIVE_ACCOUNTS) throw new Error("Encrypted vault export is too large.");
  const nameBytes = await decryptPayloadWithContext(vaultKey, deserializeEncryptedEnvelope(encryptedName), { purpose: "vault-name", payloadType: "vault-name", ...context, keyVersion: 1 });
  const accountPlaintexts: Uint8Array[] = [];
  try {
    const vaultName = new TextDecoder("utf-8", { fatal: true }).decode(nameBytes);
    for (const [index, account] of encryptedAccounts.entries()) accountPlaintexts.push(await decryptPayloadWithContext(vaultKey, deserializeEncryptedEnvelope(account), { purpose: "authenticator-account", payloadType: "totp-configuration", ...context, accountId: accountIds[index], keyVersion: 1 }));
    return await createEncryptedVaultArchive(archiveKey, vaultName, accountPlaintexts);
  } finally {
    nameBytes.fill(0);
    for (const account of accountPlaintexts) account.fill(0);
  }
}

/** Opens a supported archive in the browser; callers must validate and immediately re-encrypt every account. */
export async function openEncryptedVaultExport(archiveKey: Uint8Array, archive: Uint8Array): Promise<{ vaultName: string; accounts: Uint8Array[] }> {
  if (archive.length > MAX_ENCRYPTED_VAULT_ARCHIVE_BYTES) throw new Error("Encrypted vault export is too large.");
  const plaintext = await decryptPayloadWithContext(archiveKey, deserializeEncryptedEnvelope(archive), { purpose: "encrypted-archive", payloadType: "vault-archive", archiveVersion: FORMAT_VERSION });
  try {
    if (plaintext.length > MAX_ENCRYPTED_VAULT_ARCHIVE_BYTES - 29) throw new Error("Encrypted vault export is too large.");
    let decoded: unknown;
    try {
      decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext));
    } catch {
      throw new Error("Encrypted vault export is invalid.");
    }
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) throw new Error("Encrypted vault export is invalid.");
    const payload = decoded as Partial<VaultExportPayload>;
    if (Object.keys(payload).sort().join(",") !== "accounts,vaultName,version" || payload.version !== FORMAT_VERSION || typeof payload.vaultName !== "string" || !payload.vaultName.trim() || payload.vaultName.length > MAX_VAULT_NAME_LENGTH || !Array.isArray(payload.accounts) || payload.accounts.length > MAX_VAULT_ARCHIVE_ACCOUNTS || !payload.accounts.every(validArchivedAccount)) throw new Error("Encrypted vault export is invalid.");
    const accounts: Uint8Array[] = [];
    try {
      for (const encoded of payload.accounts) accounts.push(base64ToBytes(encoded));
      return { vaultName: payload.vaultName.trim(), accounts };
    } catch (error) {
      for (const account of accounts) account.fill(0);
      throw error;
    }
  } finally {
    plaintext.fill(0);
  }
}

function validArchivedAccount(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > Math.ceil(MAX_ARCHIVED_ACCOUNT_BYTES / 3) * 4) return false;
  return /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value);
}
