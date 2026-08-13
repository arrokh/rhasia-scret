import { MAX_ENCRYPTED_VAULT_ARCHIVE_BYTES, MAX_VAULT_ARCHIVE_ACCOUNTS } from "../../../shared/application/archive-parameters";
import { base64ToBytes, bytesToBase64 } from "../../../shared/application/base64";
import type { ClientCryptoPort } from "./crypto-ports";

const FORMAT_VERSION = 1;
const MAX_VAULT_NAME_LENGTH = 120;
const MAX_ARCHIVED_ACCOUNT_BYTES = 16 * 1024;
type VaultExportPayload = { version: 1; vaultName: string; accounts: string[] };

export function createVaultArchiveProtocol(crypto: ClientCryptoPort) {
  return {
    createEncryptedVaultArchive: async (archiveKey: Uint8Array, vaultName: string, accountPlaintexts: Uint8Array[]): Promise<Uint8Array> => {
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
        return crypto.serializeEncryptedEnvelope(await crypto.encryptPayloadWithContext(archiveKey, plaintext, {
          purpose: "encrypted-archive",
          payloadType: "vault-archive",
          archiveVersion: FORMAT_VERSION,
        }));
      } finally {
        plaintext.fill(0);
      }
    },
    openEncryptedVaultExport: async (archiveKey: Uint8Array, archive: Uint8Array): Promise<{ vaultName: string; accounts: Uint8Array[] }> => {
      if (archive.length > MAX_ENCRYPTED_VAULT_ARCHIVE_BYTES) throw new Error("Encrypted vault export is too large.");
      const envelope = crypto.deserializeEncryptedEnvelope(archive);
      if (envelope.version !== 2) throw new Error("Encrypted vault export is invalid.");
      const plaintext = await crypto.decryptPayloadWithContext(archiveKey, envelope, {
        purpose: "encrypted-archive",
        payloadType: "vault-archive",
        archiveVersion: FORMAT_VERSION,
      });
      try {
        if (plaintext.length > MAX_ENCRYPTED_VAULT_ARCHIVE_BYTES - 29) throw new Error("Encrypted vault export is too large.");
        const payload = parsePayload(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext)));
        const accounts: Uint8Array[] = [];
        try {
          for (const encoded of payload.accounts) accounts.push(base64ToBytes(encoded));
          return { vaultName: payload.vaultName.trim(), accounts };
        } catch (error) {
          for (const account of accounts) account.fill(0);
          throw error;
        }
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("Encrypted vault export")) throw error;
        throw new Error("Encrypted vault export is invalid.", { cause: error });
      } finally {
        plaintext.fill(0);
      }
    },
  };
}

function parsePayload(value: unknown): VaultExportPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const payload = value as Partial<VaultExportPayload>;
  if (Object.keys(payload).sort().join(",") !== "accounts,vaultName,version"
    || payload.version !== FORMAT_VERSION
    || typeof payload.vaultName !== "string"
    || !payload.vaultName.trim()
    || payload.vaultName.length > MAX_VAULT_NAME_LENGTH
    || !Array.isArray(payload.accounts)
    || payload.accounts.length > MAX_VAULT_ARCHIVE_ACCOUNTS
    || !payload.accounts.every(validArchivedAccount)) invalid();
  return payload as VaultExportPayload;
}

function validArchivedAccount(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= Math.ceil(MAX_ARCHIVED_ACCOUNT_BYTES / 3) * 4
    && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value);
}

function invalid(): never {
  throw new Error("Encrypted vault export is invalid.");
}
