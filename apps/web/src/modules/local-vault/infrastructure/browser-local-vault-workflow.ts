"use client";

import {
  browserCryptoPrimitives,
  createEncryptedVaultExport,
  decryptPayload,
  decryptPayloadWithContext,
  encryptPayload,
  deserializeEncryptedEnvelope,
  encryptPayloadWithContext,
  generateSymmetricKey,
  openEncryptedVaultExport,
  serializeEncryptedEnvelope,
  deriveVaultUnlockKey,
  validateVaultUnlockSecret,
  type CryptoEnvelopeContext,
  type EncryptedEnvelope,
} from "@/modules/crypto";
import { browserAccountPayloadPort, type DecryptedAuthenticatorAccount } from "@/modules/authenticator-account";
import type { TotpConfiguration } from "@/modules/otp-runtime";
import { BrowserLocalVaultRepository } from "./browser-local-vault-repository";
import {
  addLocalAccount as addLocalAccountWorkflow,
  clearUnlockedLocalVault,
  createLocalVault as createLocalVaultWorkflow,
  deleteLocalAccount as deleteLocalAccountWorkflow,
  exportLocalVault as exportLocalVaultWorkflow,
  importLocalVaultArchive as importLocalVaultArchiveWorkflow,
  migrateLegacyLocalVault as migrateLegacyLocalVaultWorkflow,
  previewLocalVaultArchive as previewLocalVaultArchiveWorkflow,
  refreshUnlockedLocalVault as refreshUnlockedLocalVaultWorkflow,
  renameLocalVault as renameLocalVaultWorkflow,
  unlockLocalVault as unlockLocalVaultWorkflow,
  updateLocalAccount as updateLocalAccountWorkflow,
  LocalVaultMigrationRequiredError,
  type UnlockedLocalVault,
  type UnlockedLocalVaultAccount,
} from "../application/local-vault-workflow";
import type { LocalVaultWorkflowDependencies } from "../application/local-vault-workflow-ports";
import type { LocalVaultRecord } from "../domain/local-vault-record";

export { clearUnlockedLocalVault, LocalVaultMigrationRequiredError };
export type { UnlockedLocalVault, UnlockedLocalVaultAccount };

function browserDependencies(): LocalVaultWorkflowDependencies {
  return {
    repository: new BrowserLocalVaultRepository(),
    crypto: {
      randomBytes: (length) => browserCryptoPrimitives.randomBytes(length),
      generateSymmetricKey,
      deriveVaultUnlockKey,
      validateVaultUnlockSecret,
      encryptPayload: (key, plaintext) => encryptPayload(key, plaintext),
      decryptPayload: (key, envelope) => decryptPayload(key, envelope),
      encryptPayloadWithContext: (key, plaintext, context) => encryptPayloadWithContext(key, plaintext, context),
      decryptPayloadWithContext: (key, envelope, context) => decryptPayloadWithContext(key, envelope, context),
      serializeEncryptedEnvelope,
      deserializeEncryptedEnvelope,
      createEncryptedVaultExport: (vaultKey, archiveKey, encryptedName, encryptedAccounts, context, accountIds) =>
        createEncryptedVaultExport(vaultKey, archiveKey, encryptedName, encryptedAccounts, context, accountIds),
      openEncryptedVaultExport,
    },
    accountPayload: {
      ...browserAccountPayloadPort,
      encryptAccountConfiguration: (vaultKey, configuration, context: CryptoEnvelopeContext) =>
        browserAccountPayloadPort.encryptAccountConfiguration(vaultKey, configuration, context),
      decryptAccountConfiguration: (vaultKey, encryptedPayload, context: CryptoEnvelopeContext) =>
        browserAccountPayloadPort.decryptAccountConfiguration(vaultKey, encryptedPayload, context),
      isDuplicateAccount: (candidate, accounts) =>
        browserAccountPayloadPort.isDuplicateAccount(candidate, accounts as DecryptedAuthenticatorAccount[]),
    },
  };
}

export async function createLocalVault(passphrase: string, name: string): Promise<LocalVaultRecord> {
  return createLocalVaultWorkflow(passphrase, name, browserDependencies());
}

export async function unlockLocalVault(record: LocalVaultRecord, passphrase: string): Promise<UnlockedLocalVault> {
  return unlockLocalVaultWorkflow(record, passphrase, browserDependencies());
}

export async function migrateLegacyLocalVault(passphrase: string): Promise<LocalVaultRecord> {
  return migrateLegacyLocalVaultWorkflow(passphrase, browserDependencies());
}

export async function addLocalAccount(vault: UnlockedLocalVault, configuration: TotpConfiguration): Promise<void> {
  return addLocalAccountWorkflow(vault, configuration, browserDependencies());
}

export async function updateLocalAccount(
  vault: UnlockedLocalVault,
  accountId: string,
  configuration: TotpConfiguration,
): Promise<void> {
  return updateLocalAccountWorkflow(vault, accountId, configuration, browserDependencies());
}

export async function renameLocalVault(vault: UnlockedLocalVault, name: string): Promise<void> {
  return renameLocalVaultWorkflow(vault, name, browserDependencies());
}

export async function deleteLocalAccount(vault: UnlockedLocalVault, accountId: string): Promise<void> {
  return deleteLocalAccountWorkflow(vault, accountId, browserDependencies());
}

export async function exportLocalVault(vault: UnlockedLocalVault): Promise<{ archive: Uint8Array; key: Uint8Array }> {
  return exportLocalVaultWorkflow(vault, browserDependencies());
}

export async function previewLocalVaultArchive(
  key: Uint8Array,
  archive: Uint8Array,
): Promise<{ vaultName: string; accounts: DecryptedAuthenticatorAccount[] }> {
  return previewLocalVaultArchiveWorkflow(key, archive, browserDependencies());
}

export async function refreshUnlockedLocalVault(vault: UnlockedLocalVault): Promise<UnlockedLocalVault> {
  return refreshUnlockedLocalVaultWorkflow(vault, browserDependencies());
}

export async function importLocalVaultArchive(
  vault: UnlockedLocalVault,
  key: Uint8Array,
  archive: Uint8Array,
): Promise<number> {
  return importLocalVaultArchiveWorkflow(vault, key, archive, browserDependencies());
}

export type { EncryptedEnvelope };
