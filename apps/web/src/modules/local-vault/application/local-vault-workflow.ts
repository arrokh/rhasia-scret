import type { DecryptedAuthenticatorAccount } from "@/modules/authenticator-account";
import type { TotpConfiguration } from "@/modules/otp-runtime";
import { base64ToBytes, bytesToBase64 } from "@rhasia-scret/client-vault-core";
import { ARGON2_ITERATIONS, ARGON2_MEMORY_KIB, ARGON2_PARALLELISM } from "@rhasia-scret/client-vault-core";
import {
  LOCAL_VAULT_ENCRYPTION_VERSION,
  LOCAL_VAULT_RECORD_VERSION,
  parseLocalVaultRecord,
  type LocalVaultRecord,
} from "../domain/local-vault-record";
import type { LocalVaultWorkflowDependencies } from "./local-vault-workflow-ports";

export type UnlockedLocalVaultAccount = DecryptedAuthenticatorAccount & { id: string; revision: number };
export class LocalVaultMigrationRequiredError extends Error {
  public constructor() {
    super("This Local Vault requires an explicit encrypted-envelope migration.");
    this.name = "LocalVaultMigrationRequiredError";
  }
}

export type UnlockedLocalVault = {
  profileId: string;
  createdAt: string;
  name: string;
  rootKey: Uint8Array;
  vaultKey: Uint8Array;
  accounts: UnlockedLocalVaultAccount[];
};

export async function createLocalVault(
  passphrase: string,
  name: string,
  dependencies: LocalVaultWorkflowDependencies,
): Promise<LocalVaultRecord> {
  dependencies.crypto.validateVaultUnlockSecret(passphrase);
  const normalizedName = name.trim();
  if (!normalizedName || normalizedName.length > 120) throw new Error("A Local Vault name is required.");
  const salt = dependencies.crypto.randomBytes(16);
  const profileId = randomOpaqueId(dependencies);
  let unlockKey: Uint8Array | undefined;
  let rootKey: Uint8Array | undefined;
  let vaultKey: Uint8Array | undefined;
  try {
    unlockKey = await dependencies.crypto.deriveVaultUnlockKey(passphrase, salt);
    rootKey = dependencies.crypto.generateSymmetricKey();
    vaultKey = dependencies.crypto.generateSymmetricKey();
    const nameBytes = new TextEncoder().encode(normalizedName);
    try {
      return {
        version: LOCAL_VAULT_RECORD_VERSION,
        profileId,
        createdAt: new Date().toISOString(),
        kdf: {
          algorithm: "ARGON2ID",
          memoryKiB: ARGON2_MEMORY_KIB,
          iterations: ARGON2_ITERATIONS,
          parallelism: ARGON2_PARALLELISM,
          salt: bytesToBase64(salt),
        },
        wrappedLocalRootKey: bytesToBase64(
          dependencies.crypto.serializeEncryptedEnvelope(
            await dependencies.crypto.encryptPayloadWithContext(unlockKey, rootKey, {
              purpose: "local-root-key-wrap",
              payloadType: "local-root-key",
              profileId,
              keyVersion: 1,
            }),
          ),
        ),
        encryptedLocalVaultKey: bytesToBase64(
          dependencies.crypto.serializeEncryptedEnvelope(
            await dependencies.crypto.encryptPayloadWithContext(rootKey, vaultKey, {
              purpose: "vault-key-wrap",
              payloadType: "vault-encryption-key",
              profileId,
              keyVersion: 1,
            }),
          ),
        ),
        encryptedVaultName: bytesToBase64(
          dependencies.crypto.serializeEncryptedEnvelope(
            await dependencies.crypto.encryptPayloadWithContext(vaultKey, nameBytes, {
              purpose: "vault-name",
              payloadType: "vault-name",
              profileId,
              keyVersion: 1,
            }),
          ),
        ),
        accounts: [],
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

export async function unlockLocalVault(
  recordInput: LocalVaultRecord,
  passphrase: string,
  dependencies: LocalVaultWorkflowDependencies,
): Promise<UnlockedLocalVault> {
  const record = parseLocalVaultRecord(recordInput);
  if (hasLegacyEnvelope(record, dependencies)) throw new LocalVaultMigrationRequiredError();
  dependencies.crypto.validateVaultUnlockSecret(passphrase);
  let unlockKey: Uint8Array | undefined;
  let rootKey: Uint8Array | undefined;
  let vaultKey: Uint8Array | undefined;
  try {
    const salt = base64ToBytes(record.kdf.salt);
    try {
      unlockKey = await dependencies.crypto.deriveVaultUnlockKey(passphrase, salt);
    } finally {
      salt.fill(0);
    }
    rootKey = (
      await decryptLocalPayload(
        unlockKey,
        record.wrappedLocalRootKey,
        { purpose: "local-root-key-wrap", payloadType: "local-root-key", profileId: record.profileId, keyVersion: 1 },
        dependencies,
        false,
      )
    ).plaintext;
    if (rootKey.length !== 32) throw new Error("The Local Root Key is invalid.");
    vaultKey = (
      await decryptLocalPayload(
        rootKey,
        record.encryptedLocalVaultKey,
        { purpose: "vault-key-wrap", payloadType: "vault-encryption-key", profileId: record.profileId, keyVersion: 1 },
        dependencies,
        false,
      )
    ).plaintext;
    if (vaultKey.length !== 32) throw new Error("The Local Vault Encryption Key is invalid.");
    const nameBytes = (
      await decryptLocalPayload(
        vaultKey,
        record.encryptedVaultName,
        { purpose: "vault-name", payloadType: "vault-name", profileId: record.profileId, keyVersion: 1 },
        dependencies,
        false,
      )
    ).plaintext;
    let name: string;
    try {
      name = validateLocalVaultName(nameBytes);
    } finally {
      nameBytes.fill(0);
    }
    const accounts: UnlockedLocalVaultAccount[] = [];
    try {
      for (const account of record.accounts) {
        const ciphertext = base64ToBytes(account.encryptedPayload);
        try {
          const decrypted = await dependencies.accountPayload.decryptAccountConfiguration(vaultKey, ciphertext, {
            purpose: "authenticator-account",
            payloadType: "totp-configuration",
            profileId: record.profileId,
            accountId: account.id,
            keyVersion: account.encryptionVersion,
          });
          accounts.push({ ...decrypted, id: account.id, revision: account.revision });
        } finally {
          ciphertext.fill(0);
        }
      }
      return {
        profileId: record.profileId,
        createdAt: record.createdAt,
        name,
        rootKey,
        vaultKey,
        accounts: sortAccounts(accounts),
      };
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

export async function migrateLegacyLocalVault(
  passphrase: string,
  dependencies: LocalVaultWorkflowDependencies,
): Promise<LocalVaultRecord> {
  const repository = dependencies.repository;
  const record = await repository.read();
  if (!record) throw new Error("The Local Profile does not exist.");
  if (!hasLegacyEnvelope(record, dependencies)) return record;
  dependencies.crypto.validateVaultUnlockSecret(passphrase);
  const salt = base64ToBytes(record.kdf.salt);
  let unlockKey: Uint8Array | undefined;
  let rootKey: Uint8Array | undefined;
  let vaultKey: Uint8Array | undefined;
  let nameBytes: Uint8Array | undefined;
  try {
    unlockKey = await dependencies.crypto.deriveVaultUnlockKey(passphrase, salt);
    const root = await decryptLocalPayload(
      unlockKey,
      record.wrappedLocalRootKey,
      { purpose: "local-root-key-wrap", payloadType: "local-root-key", profileId: record.profileId, keyVersion: 1 },
      dependencies,
      true,
    );
    rootKey = root.plaintext;
    if (rootKey.length !== 32) throw new Error("The Local Root Key is invalid.");
    const vault = await decryptLocalPayload(
      rootKey,
      record.encryptedLocalVaultKey,
      { purpose: "vault-key-wrap", payloadType: "vault-encryption-key", profileId: record.profileId, keyVersion: 1 },
      dependencies,
      true,
    );
    vaultKey = vault.plaintext;
    if (vaultKey.length !== 32) throw new Error("The Local Vault Encryption Key is invalid.");
    const name = await decryptLocalPayload(
      vaultKey,
      record.encryptedVaultName,
      { purpose: "vault-name", payloadType: "vault-name", profileId: record.profileId, keyVersion: 1 },
      dependencies,
      true,
    );
    nameBytes = name.plaintext;
    validateLocalVaultName(nameBytes);
    const migratedAccounts = [];
    for (const account of record.accounts) {
      const context = {
        purpose: "authenticator-account" as const,
        payloadType: "totp-configuration" as const,
        profileId: record.profileId,
        accountId: account.id,
        keyVersion: account.encryptionVersion,
      };
      const opened = await decryptLocalPayload(vaultKey, account.encryptedPayload, context, dependencies, true);
      let validatedAccount: DecryptedAuthenticatorAccount | undefined;
      let canonicalPlaintext: Uint8Array | undefined;
      try {
        validatedAccount = dependencies.accountPayload.parseDecryptedAccountPayload(opened.plaintext);
        let encryptedPayload = account.encryptedPayload;
        if (opened.version === 1) {
          canonicalPlaintext = dependencies.accountPayload.serializeDecryptedAccountPayload(validatedAccount);
          encryptedPayload = await encryptLocalPayload(vaultKey, canonicalPlaintext, context, dependencies);
        }
        migratedAccounts.push({ ...account, encryptedPayload });
      } finally {
        opened.plaintext.fill(0);
        validatedAccount?.secret.fill(0);
        canonicalPlaintext?.fill(0);
      }
    }
    const migrated = parseLocalVaultRecord({
      ...record,
      wrappedLocalRootKey:
        root.version === 1
          ? await encryptLocalPayload(
              unlockKey,
              rootKey,
              {
                purpose: "local-root-key-wrap",
                payloadType: "local-root-key",
                profileId: record.profileId,
                keyVersion: 1,
              },
              dependencies,
            )
          : record.wrappedLocalRootKey,
      encryptedLocalVaultKey:
        vault.version === 1
          ? await encryptLocalPayload(
              rootKey,
              vaultKey,
              {
                purpose: "vault-key-wrap",
                payloadType: "vault-encryption-key",
                profileId: record.profileId,
                keyVersion: 1,
              },
              dependencies,
            )
          : record.encryptedLocalVaultKey,
      encryptedVaultName:
        name.version === 1
          ? await encryptLocalPayload(
              vaultKey,
              nameBytes,
              { purpose: "vault-name", payloadType: "vault-name", profileId: record.profileId, keyVersion: 1 },
              dependencies,
            )
          : record.encryptedVaultName,
      accounts: migratedAccounts,
    });
    await repository.replace(migrated);
    return migrated;
  } finally {
    salt.fill(0);
    unlockKey?.fill(0);
    rootKey?.fill(0);
    vaultKey?.fill(0);
    nameBytes?.fill(0);
  }
}

export function clearUnlockedLocalVault(vault: UnlockedLocalVault | null): void {
  if (!vault) return;
  vault.rootKey.fill(0);
  vault.vaultKey.fill(0);
  for (const account of vault.accounts) account.secret.fill(0);
}

export async function addLocalAccount(
  vault: UnlockedLocalVault,
  configuration: TotpConfiguration,
  dependencies: LocalVaultWorkflowDependencies,
): Promise<void> {
  try {
    if (dependencies.accountPayload.isDuplicateAccount(configuration, vault.accounts))
      throw new Error("A duplicate Local Vault account already exists.");
    const id = randomOpaqueId(dependencies);
    const encryptedPayload = await dependencies.accountPayload.encryptAccountConfiguration(
      vault.vaultKey,
      configuration,
      {
        purpose: "authenticator-account",
        payloadType: "totp-configuration",
        profileId: vault.profileId,
        accountId: id,
        keyVersion: 1,
      },
    );
    const retained = { ...configuration, secret: configuration.secret.slice(), id, revision: 1 };
    await updateRecord(
      vault,
      (record) => ({
        ...record,
        accounts: [
          ...record.accounts,
          {
            id,
            encryptedPayload: bytesToBase64(encryptedPayload),
            encryptionVersion: LOCAL_VAULT_ENCRYPTION_VERSION,
            revision: 1,
          },
        ],
      }),
      dependencies,
    );
    vault.accounts.push(retained);
    vault.accounts.sort(accountSort);
  } finally {
    configuration.secret.fill(0);
  }
}

export async function updateLocalAccount(
  vault: UnlockedLocalVault,
  accountId: string,
  configuration: TotpConfiguration,
  dependencies: LocalVaultWorkflowDependencies,
): Promise<void> {
  try {
    const current = vault.accounts.find((account) => account.id === accountId);
    if (!current) throw new Error("The Local Vault account was not found.");
    const peers = vault.accounts.filter((account) => account.id !== accountId);
    if (dependencies.accountPayload.isDuplicateAccount(configuration, peers))
      throw new Error("A duplicate Local Vault account already exists.");
    const encryptedPayload = await dependencies.accountPayload.encryptAccountConfiguration(
      vault.vaultKey,
      configuration,
      {
        purpose: "authenticator-account",
        payloadType: "totp-configuration",
        profileId: vault.profileId,
        accountId: current.id,
        keyVersion: 1,
      },
    );
    const revision = current.revision + 1;
    await updateRecord(
      vault,
      (record) => ({
        ...record,
        accounts: record.accounts.map((account) =>
          account.id === accountId
            ? { ...account, encryptedPayload: bytesToBase64(encryptedPayload), revision }
            : account,
        ),
      }),
      dependencies,
    );
    const retained = { ...configuration, secret: configuration.secret.slice(), id: current.id, revision };
    current.secret.fill(0);
    Object.assign(current, retained);
    vault.accounts.sort(accountSort);
  } finally {
    configuration.secret.fill(0);
  }
}

export async function renameLocalVault(
  vault: UnlockedLocalVault,
  name: string,
  dependencies: LocalVaultWorkflowDependencies,
): Promise<void> {
  const normalizedName = name.trim();
  if (!normalizedName || normalizedName.length > 120) throw new Error("A Local Vault name is required.");
  const nameBytes = new TextEncoder().encode(normalizedName);
  try {
    const encryptedVaultName = bytesToBase64(
      dependencies.crypto.serializeEncryptedEnvelope(
        await dependencies.crypto.encryptPayloadWithContext(vault.vaultKey, nameBytes, {
          purpose: "vault-name",
          payloadType: "vault-name",
          profileId: vault.profileId,
          keyVersion: 1,
        }),
      ),
    );
    await updateRecord(vault, (record) => ({ ...record, encryptedVaultName }), dependencies);
    vault.name = normalizedName;
  } finally {
    nameBytes.fill(0);
  }
}

export async function deleteLocalAccount(
  vault: UnlockedLocalVault,
  accountId: string,
  dependencies: LocalVaultWorkflowDependencies,
): Promise<void> {
  const account = vault.accounts.find((entry) => entry.id === accountId);
  if (!account) throw new Error("The Local Vault account was not found.");
  await updateRecord(
    vault,
    (record) => ({ ...record, accounts: record.accounts.filter((entry) => entry.id !== accountId) }),
    dependencies,
  );
  account.secret.fill(0);
  vault.accounts.splice(vault.accounts.indexOf(account), 1);
}

export async function exportLocalVault(
  vault: UnlockedLocalVault,
  dependencies: LocalVaultWorkflowDependencies,
): Promise<{ archive: Uint8Array; key: Uint8Array }> {
  const record = await dependencies.repository.read();
  if (!record || record.profileId !== vault.profileId) throw new Error("The Local Profile is unavailable.");
  const key = dependencies.crypto.generateSymmetricKey();
  try {
    const archive = await dependencies.crypto.createEncryptedVaultExport(
      vault.vaultKey,
      key,
      base64ToBytes(record.encryptedVaultName),
      record.accounts.map((account) => base64ToBytes(account.encryptedPayload)),
      { profileId: vault.profileId },
      record.accounts.map((account) => account.id),
    );
    return { archive, key };
  } catch (error) {
    key.fill(0);
    throw error;
  }
}

export async function previewLocalVaultArchive(
  key: Uint8Array,
  archive: Uint8Array,
  dependencies: LocalVaultWorkflowDependencies,
): Promise<{ vaultName: string; accounts: DecryptedAuthenticatorAccount[] }> {
  const opened = await dependencies.crypto.openEncryptedVaultExport(key, archive);
  const accounts: DecryptedAuthenticatorAccount[] = [];
  try {
    for (const plaintext of opened.accounts) {
      try {
        accounts.push(dependencies.accountPayload.parseDecryptedAccountPayload(plaintext));
      } finally {
        plaintext.fill(0);
      }
    }
    return { vaultName: opened.vaultName, accounts };
  } catch (error) {
    for (const account of accounts) account.secret.fill(0);
    throw error;
  }
}

export async function refreshUnlockedLocalVault(
  vault: UnlockedLocalVault,
  dependencies: LocalVaultWorkflowDependencies,
): Promise<UnlockedLocalVault> {
  const record = await dependencies.repository.read();
  if (!record || record.profileId !== vault.profileId) throw new Error("The Local Profile is unavailable.");
  const nameBytes = await dependencies.crypto.decryptPayloadWithContext(
    vault.vaultKey,
    dependencies.crypto.deserializeEncryptedEnvelope(base64ToBytes(record.encryptedVaultName)),
    { purpose: "vault-name", payloadType: "vault-name", profileId: vault.profileId, keyVersion: 1 },
  );
  let name: string;
  try {
    name = new TextDecoder("utf-8", { fatal: true }).decode(nameBytes).trim();
  } finally {
    nameBytes.fill(0);
  }
  const accounts: UnlockedLocalVaultAccount[] = [];
  const rootKey = vault.rootKey.slice();
  const vaultKey = vault.vaultKey.slice();
  try {
    for (const account of record.accounts)
      accounts.push({
        ...(await dependencies.accountPayload.decryptAccountConfiguration(
          vaultKey,
          base64ToBytes(account.encryptedPayload),
          {
            purpose: "authenticator-account",
            payloadType: "totp-configuration",
            profileId: vault.profileId,
            accountId: account.id,
            keyVersion: account.encryptionVersion,
          },
        )),
        id: account.id,
        revision: account.revision,
      });
    return { ...vault, name, rootKey, vaultKey, accounts: sortAccounts(accounts) };
  } catch (error) {
    rootKey.fill(0);
    vaultKey.fill(0);
    for (const account of accounts) account.secret.fill(0);
    throw error;
  }
}

export async function importLocalVaultArchive(
  vault: UnlockedLocalVault,
  key: Uint8Array,
  archive: Uint8Array,
  dependencies: LocalVaultWorkflowDependencies,
): Promise<number> {
  const opened = await dependencies.crypto.openEncryptedVaultExport(key, archive);
  const additions: Array<{ id: string; configuration: DecryptedAuthenticatorAccount; encryptedPayload: string }> = [];
  try {
    const existing = [...vault.accounts];
    for (const plaintext of opened.accounts) {
      const configuration = dependencies.accountPayload.parseDecryptedAccountPayload(plaintext);
      plaintext.fill(0);
      if (dependencies.accountPayload.isDuplicateAccount(configuration, existing)) {
        configuration.secret.fill(0);
        continue;
      }
      try {
        const id = randomOpaqueId(dependencies);
        const encryptedPayload = await dependencies.accountPayload.encryptAccountConfiguration(
          vault.vaultKey,
          configuration,
          {
            purpose: "authenticator-account",
            payloadType: "totp-configuration",
            profileId: vault.profileId,
            accountId: id,
            keyVersion: 1,
          },
        );
        const retained = { ...configuration, secret: configuration.secret.slice() };
        additions.push({ id, configuration: retained, encryptedPayload: bytesToBase64(encryptedPayload) });
        existing.push({ ...retained, id, revision: 1 });
      } finally {
        configuration.secret.fill(0);
      }
    }
    if (!additions.length) return 0;
    await updateRecord(
      vault,
      (record) => ({
        ...record,
        accounts: [
          ...record.accounts,
          ...additions.map((addition) => ({
            id: addition.id,
            encryptedPayload: addition.encryptedPayload,
            encryptionVersion: LOCAL_VAULT_ENCRYPTION_VERSION,
            revision: 1,
          })),
        ],
      }),
      dependencies,
    );
    // The presentation reloads the encrypted record after the atomic write so the active workspace never retains stale account state.
    return additions.length;
  } finally {
    for (const addition of additions) addition.configuration.secret.fill(0);
    for (const plaintext of opened.accounts) plaintext.fill(0);
  }
}

async function updateRecord(
  vault: UnlockedLocalVault,
  update: (record: LocalVaultRecord) => LocalVaultRecord,
  dependencies: LocalVaultWorkflowDependencies,
): Promise<void> {
  const repository = dependencies.repository;
  const current = await repository.read();
  if (!current || current.profileId !== vault.profileId) throw new Error("The Local Profile is unavailable.");
  await repository.replace(parseLocalVaultRecord(update(current)));
}

function hasLegacyEnvelope(record: LocalVaultRecord, dependencies: LocalVaultWorkflowDependencies): boolean {
  return [
    record.wrappedLocalRootKey,
    record.encryptedLocalVaultKey,
    record.encryptedVaultName,
    ...record.accounts.map((account) => account.encryptedPayload),
  ].some((encoded) => readLocalEnvelopeVersion(encoded, dependencies) === 1);
}

async function decryptLocalPayload(
  key: Uint8Array,
  encodedCiphertext: string,
  context: Parameters<LocalVaultWorkflowDependencies["crypto"]["decryptPayloadWithContext"]>[2],
  dependencies: LocalVaultWorkflowDependencies,
  allowLegacy: boolean,
): Promise<{ plaintext: Uint8Array; version: 1 | 2 }> {
  const ciphertext = base64ToBytes(encodedCiphertext);
  let envelope: ReturnType<LocalVaultWorkflowDependencies["crypto"]["deserializeEncryptedEnvelope"]> | undefined;
  try {
    envelope = dependencies.crypto.deserializeEncryptedEnvelope(ciphertext);
    if (envelope.version === 1) {
      if (!allowLegacy) throw new LocalVaultMigrationRequiredError();
      return { plaintext: await dependencies.crypto.decryptPayload(key, envelope), version: 1 };
    }
    return { plaintext: await dependencies.crypto.decryptPayloadWithContext(key, envelope, context), version: 2 };
  } finally {
    ciphertext.fill(0);
    envelope?.nonce.fill(0);
    envelope?.ciphertext.fill(0);
  }
}

function readLocalEnvelopeVersion(encodedCiphertext: string, dependencies: LocalVaultWorkflowDependencies): 1 | 2 {
  const ciphertext = base64ToBytes(encodedCiphertext);
  let envelope: ReturnType<LocalVaultWorkflowDependencies["crypto"]["deserializeEncryptedEnvelope"]> | undefined;
  try {
    envelope = dependencies.crypto.deserializeEncryptedEnvelope(ciphertext);
    return envelope.version;
  } finally {
    ciphertext.fill(0);
    envelope?.nonce.fill(0);
    envelope?.ciphertext.fill(0);
  }
}

async function encryptLocalPayload(
  key: Uint8Array,
  plaintext: Uint8Array,
  context: Parameters<LocalVaultWorkflowDependencies["crypto"]["encryptPayloadWithContext"]>[2],
  dependencies: LocalVaultWorkflowDependencies,
): Promise<string> {
  const envelope = await dependencies.crypto.encryptPayloadWithContext(key, plaintext, context);
  let serialized: Uint8Array | undefined;
  try {
    serialized = dependencies.crypto.serializeEncryptedEnvelope(envelope);
    return bytesToBase64(serialized);
  } finally {
    envelope.nonce.fill(0);
    envelope.ciphertext.fill(0);
    serialized?.fill(0);
  }
}

function validateLocalVaultName(plaintext: Uint8Array): string {
  const name = new TextDecoder("utf-8", { fatal: true }).decode(plaintext).trim();
  if (!name || name.length > 120) throw new Error("The Local Vault name is invalid.");
  return name;
}

function randomOpaqueId(dependencies: LocalVaultWorkflowDependencies): string {
  const bytes = dependencies.crypto.randomBytes(18);
  const encoded = bytesToBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  bytes.fill(0);
  return encoded;
}

function sortAccounts(accounts: UnlockedLocalVaultAccount[]): UnlockedLocalVaultAccount[] {
  return [...accounts].sort(accountSort);
}

function accountSort(
  left: { issuer: string; accountName: string },
  right: { issuer: string; accountName: string },
): number {
  return left.issuer.localeCompare(right.issuer) || left.accountName.localeCompare(right.accountName);
}
