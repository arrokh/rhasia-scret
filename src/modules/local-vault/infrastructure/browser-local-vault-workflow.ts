"use client";

import {
  createEncryptedVaultExport,
  generateSymmetricKey,
  openEncryptedVaultExport,
  decryptPayload,
  deserializeEncryptedEnvelope,
  encryptPayload,
  serializeEncryptedEnvelope
} from "@/modules/crypto";
import { ARGON2_ITERATIONS, ARGON2_MEMORY_KIB, ARGON2_PARALLELISM, deriveVaultUnlockKey, validateVaultUnlockSecret } from "@/modules/crypto";
import { decryptAccountConfiguration, encryptAccountConfiguration, isDuplicateAccount, parseDecryptedAccountPayload, type DecryptedAuthenticatorAccount } from "@/modules/authenticator-account";
import type { TotpConfiguration } from "@/modules/otp-runtime";
import { base64ToBytes, bytesToBase64 } from "@/shared/infrastructure/browser-base64";
import { LOCAL_VAULT_ENCRYPTION_VERSION, LOCAL_VAULT_RECORD_VERSION, parseLocalVaultRecord, type LocalVaultRecord } from "../domain/local-vault-record";
import { BrowserLocalVaultRepository } from "./browser-local-vault-repository";

export type UnlockedLocalVaultAccount = DecryptedAuthenticatorAccount & { id: string; revision: number };
export type UnlockedLocalVault = {
  profileId: string;
  createdAt: string;
  name: string;
  rootKey: Uint8Array;
  vaultKey: Uint8Array;
  accounts: UnlockedLocalVaultAccount[];
};

export async function createLocalVault(passphrase: string, name: string): Promise<LocalVaultRecord> {
  validateVaultUnlockSecret(passphrase);
  const normalizedName = name.trim();
  if (!normalizedName || normalizedName.length > 120) throw new Error("A Local Vault name is required.");
  const salt = randomBytes(16);
  let unlockKey: Uint8Array | undefined;
  let rootKey: Uint8Array | undefined;
  let vaultKey: Uint8Array | undefined;
  try {
    unlockKey = await deriveVaultUnlockKey(passphrase, salt);
    rootKey = generateSymmetricKey();
    vaultKey = generateSymmetricKey();
    const nameBytes = new TextEncoder().encode(normalizedName);
    try {
      return {
      version: LOCAL_VAULT_RECORD_VERSION,
      profileId: randomOpaqueId(),
      createdAt: new Date().toISOString(),
      kdf: { algorithm: "ARGON2ID", memoryKiB: ARGON2_MEMORY_KIB, iterations: ARGON2_ITERATIONS, parallelism: ARGON2_PARALLELISM, salt: bytesToBase64(salt) },
      wrappedLocalRootKey: bytesToBase64(serializeEncryptedEnvelope(await encryptPayload(unlockKey, rootKey))),
        encryptedLocalVaultKey: bytesToBase64(serializeEncryptedEnvelope(await encryptPayload(rootKey, vaultKey))),
        encryptedVaultName: bytesToBase64(serializeEncryptedEnvelope(await encryptPayload(vaultKey, nameBytes))),
        accounts: []
      };
    } finally {
      nameBytes.fill(0);
    }
  } finally {
    salt.fill(0);
    unlockKey?.fill(0);
    rootKey?.fill(0);
    vaultKey?.fill(0);
  }
}

export async function unlockLocalVault(recordInput: LocalVaultRecord, passphrase: string): Promise<UnlockedLocalVault> {
  const record = parseLocalVaultRecord(recordInput);
  validateVaultUnlockSecret(passphrase);
  let unlockKey: Uint8Array | undefined;
  let rootKey: Uint8Array | undefined;
  let vaultKey: Uint8Array | undefined;
  try {
    unlockKey = await deriveVaultUnlockKey(passphrase, base64ToBytes(record.kdf.salt));
    rootKey = await decryptPayload(unlockKey, deserializeEncryptedEnvelope(base64ToBytes(record.wrappedLocalRootKey)));
    if (rootKey.length !== 32) throw new Error("The Local Root Key is invalid.");
    vaultKey = await decryptPayload(rootKey, deserializeEncryptedEnvelope(base64ToBytes(record.encryptedLocalVaultKey)));
    if (vaultKey.length !== 32) throw new Error("The Local Vault Encryption Key is invalid.");
    const nameBytes = await decryptPayload(vaultKey, deserializeEncryptedEnvelope(base64ToBytes(record.encryptedVaultName)));
    let name: string;
    try {
      name = new TextDecoder("utf-8", { fatal: true }).decode(nameBytes).trim();
      if (!name || name.length > 120) throw new Error("The Local Vault name is invalid.");
    } finally {
      nameBytes.fill(0);
    }
    const accounts: UnlockedLocalVaultAccount[] = [];
    try {
      for (const account of record.accounts) {
        const decrypted = await decryptAccountConfiguration(vaultKey, base64ToBytes(account.encryptedPayload));
        accounts.push({ ...decrypted, id: account.id, revision: account.revision });
      }
      return { profileId: record.profileId, createdAt: record.createdAt, name, rootKey, vaultKey, accounts: sortAccounts(accounts) };
    } catch (error) {
      for (const account of accounts) account.secret.fill(0);
      throw error;
    }
  } catch (error) {
    rootKey?.fill(0);
    vaultKey?.fill(0);
    throw error;
  } finally {
    unlockKey?.fill(0);
  }
}

export function clearUnlockedLocalVault(vault: UnlockedLocalVault | null): void {
  if (!vault) return;
  vault.rootKey.fill(0);
  vault.vaultKey.fill(0);
  for (const account of vault.accounts) account.secret.fill(0);
}

export async function addLocalAccount(vault: UnlockedLocalVault, configuration: TotpConfiguration): Promise<void> {
  try {
    if (isDuplicateAccount(configuration, vault.accounts)) throw new Error("A duplicate Local Vault account already exists.");
    const encryptedPayload = await encryptAccountConfiguration(vault.vaultKey, configuration);
    const id = randomOpaqueId();
    const retained = { ...configuration, secret: configuration.secret.slice(), id, revision: 1 };
    await updateRecord(vault, (record) => ({ ...record, accounts: [...record.accounts, { id, encryptedPayload: bytesToBase64(encryptedPayload), encryptionVersion: LOCAL_VAULT_ENCRYPTION_VERSION, revision: 1 }] }));
    vault.accounts.push(retained);
    vault.accounts.sort(accountSort);
  } finally {
    configuration.secret.fill(0);
  }
}

export async function updateLocalAccount(vault: UnlockedLocalVault, accountId: string, configuration: TotpConfiguration): Promise<void> {
  try {
    const current = vault.accounts.find((account) => account.id === accountId);
    if (!current) throw new Error("The Local Vault account was not found.");
    const peers = vault.accounts.filter((account) => account.id !== accountId);
    if (isDuplicateAccount(configuration, peers)) throw new Error("A duplicate Local Vault account already exists.");
    const encryptedPayload = await encryptAccountConfiguration(vault.vaultKey, configuration);
    const revision = current.revision + 1;
    await updateRecord(vault, (record) => ({ ...record, accounts: record.accounts.map((account) => account.id === accountId ? { ...account, encryptedPayload: bytesToBase64(encryptedPayload), revision } : account) }));
    const retained = { ...configuration, secret: configuration.secret.slice(), id: current.id, revision };
    current.secret.fill(0);
    Object.assign(current, retained);
    vault.accounts.sort(accountSort);
  } finally {
    configuration.secret.fill(0);
  }
}

export async function deleteLocalAccount(vault: UnlockedLocalVault, accountId: string): Promise<void> {
  const account = vault.accounts.find((entry) => entry.id === accountId);
  if (!account) throw new Error("The Local Vault account was not found.");
  await updateRecord(vault, (record) => ({ ...record, accounts: record.accounts.filter((entry) => entry.id !== accountId) }));
  account.secret.fill(0);
  vault.accounts.splice(vault.accounts.indexOf(account), 1);
}

export async function exportLocalVault(vault: UnlockedLocalVault): Promise<{ archive: Uint8Array; key: Uint8Array }> {
  const record = await new BrowserLocalVaultRepository().read();
  if (!record || record.profileId !== vault.profileId) throw new Error("The Local Profile is unavailable.");
  const key = generateSymmetricKey();
  try {
    const archive = await createEncryptedVaultExport(vault.vaultKey, key, base64ToBytes(record.encryptedVaultName), record.accounts.map((account) => base64ToBytes(account.encryptedPayload)));
    return { archive, key };
  } catch (error) {
    key.fill(0);
    throw error;
  }
}

export async function previewLocalVaultArchive(key: Uint8Array, archive: Uint8Array): Promise<{ vaultName: string; accounts: DecryptedAuthenticatorAccount[] }> {
  const opened = await openEncryptedVaultExport(key, archive);
  const accounts: DecryptedAuthenticatorAccount[] = [];
  try {
    for (const plaintext of opened.accounts) {
      try { accounts.push(parseDecryptedAccountPayload(plaintext)); }
      finally { plaintext.fill(0); }
    }
    return { vaultName: opened.vaultName, accounts };
  } catch (error) {
    for (const account of accounts) account.secret.fill(0);
    throw error;
  }
}

export async function refreshUnlockedLocalVault(vault: UnlockedLocalVault): Promise<UnlockedLocalVault> {
  const record = await new BrowserLocalVaultRepository().read();
  if (!record || record.profileId !== vault.profileId) throw new Error("The Local Profile is unavailable.");
  const nameBytes = await decryptPayload(vault.vaultKey, deserializeEncryptedEnvelope(base64ToBytes(record.encryptedVaultName)));
  let name: string;
  try { name = new TextDecoder("utf-8", { fatal: true }).decode(nameBytes).trim(); }
  finally { nameBytes.fill(0); }
  const accounts: UnlockedLocalVaultAccount[] = [];
  try {
    for (const account of record.accounts) accounts.push({ ...(await decryptAccountConfiguration(vault.vaultKey, base64ToBytes(account.encryptedPayload))), id: account.id, revision: account.revision });
    return { ...vault, name, accounts: sortAccounts(accounts) };
  } catch (error) {
    for (const account of accounts) account.secret.fill(0);
    throw error;
  }
}

export async function importLocalVaultArchive(vault: UnlockedLocalVault, key: Uint8Array, archive: Uint8Array): Promise<number> {
  const opened = await openEncryptedVaultExport(key, archive);
  const additions: Array<{ configuration: DecryptedAuthenticatorAccount; encryptedPayload: string }> = [];
  try {
    const existing = [...vault.accounts];
    for (const plaintext of opened.accounts) {
      const configuration = parseDecryptedAccountPayload(plaintext);
      plaintext.fill(0);
      if (isDuplicateAccount(configuration, existing)) { configuration.secret.fill(0); continue; }
      try {
        const encryptedPayload = await encryptAccountConfiguration(vault.vaultKey, configuration);
        const retained = { ...configuration, secret: configuration.secret.slice() };
        additions.push({ configuration: retained, encryptedPayload: bytesToBase64(encryptedPayload) });
        existing.push({ ...retained, id: randomOpaqueId(), revision: 1 });
      } finally {
        configuration.secret.fill(0);
      }
    }
    if (!additions.length) return 0;
    await updateRecord(vault, (record) => ({ ...record, accounts: [...record.accounts, ...additions.map((addition) => ({ id: randomOpaqueId(), encryptedPayload: addition.encryptedPayload, encryptionVersion: LOCAL_VAULT_ENCRYPTION_VERSION, revision: 1 }))] }));
    // The presentation reloads the encrypted record after the atomic write so the active workspace never retains stale account state.
    return additions.length;
  } finally {
    for (const addition of additions) addition.configuration.secret.fill(0);
    for (const plaintext of opened.accounts) plaintext.fill(0);
  }
}

async function updateRecord(vault: UnlockedLocalVault, update: (record: LocalVaultRecord) => LocalVaultRecord): Promise<void> {
  const repository = new BrowserLocalVaultRepository();
  const current = await repository.read();
  if (!current || current.profileId !== vault.profileId) throw new Error("The Local Profile is unavailable.");
  await repository.replace(parseLocalVaultRecord(update(current)));
}

function randomOpaqueId(): string {
  const bytes = randomBytes(18);
  const encoded = bytesToBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  bytes.fill(0);
  return encoded;
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function sortAccounts(accounts: UnlockedLocalVaultAccount[]): UnlockedLocalVaultAccount[] {
  return [...accounts].sort(accountSort);
}

function accountSort(left: { issuer: string; accountName: string }, right: { issuer: string; accountName: string }): number {
  return left.issuer.localeCompare(right.issuer) || left.accountName.localeCompare(right.accountName);
}
