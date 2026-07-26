"use client";

import { base64ToBytes, bytesToBase64 } from "@/shared/infrastructure/browser-base64";
import { decryptPayload, deserializeEncryptedEnvelope, encryptPayload, serializeEncryptedEnvelope } from "./browser-crypto-envelope";

const FORMAT_VERSION = 1;

type VaultExportPayload = { version: 1; vaultName: string; accounts: string[] };

/** Produces a portable encrypted archive entirely in the browser. */
export async function createEncryptedVaultExport(vaultKey: Uint8Array, archiveKey: Uint8Array, encryptedName: Uint8Array, encryptedAccounts: Uint8Array[]): Promise<Uint8Array> {
  const vaultName = new TextDecoder().decode(await decryptPayload(vaultKey, deserializeEncryptedEnvelope(encryptedName)));
  const accounts = await Promise.all(encryptedAccounts.map(async (account) => bytesToBase64(await decryptPayload(vaultKey, deserializeEncryptedEnvelope(account)))));
  const payload: VaultExportPayload = { version: FORMAT_VERSION, vaultName, accounts };
  return serializeEncryptedEnvelope(await encryptPayload(archiveKey, new TextEncoder().encode(JSON.stringify(payload))));
}

/** Opens an archive in the browser; callers must immediately re-encrypt it under a destination Vault Encryption Key. */
export async function openEncryptedVaultExport(archiveKey: Uint8Array, archive: Uint8Array): Promise<{ vaultName: string; accounts: Uint8Array[] }> {
  const decoded: unknown = JSON.parse(new TextDecoder().decode(await decryptPayload(archiveKey, deserializeEncryptedEnvelope(archive))));
  if (!decoded || typeof decoded !== "object") throw new Error("Encrypted vault export is invalid.");
  const payload = decoded as Partial<VaultExportPayload>;
  if (payload.version !== FORMAT_VERSION || typeof payload.vaultName !== "string" || !Array.isArray(payload.accounts) || !payload.accounts.every((account) => typeof account === "string")) throw new Error("Encrypted vault export is invalid.");
  return { vaultName: payload.vaultName, accounts: payload.accounts.map(base64ToBytes) };
}
