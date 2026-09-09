export const LOCAL_VAULT_RECORD_VERSION = 1 as const;
export const LOCAL_VAULT_ENCRYPTION_VERSION = 1 as const;

export type LocalVaultKdfParameters = {
  algorithm: "ARGON2ID";
  memoryKiB: number;
  iterations: number;
  parallelism: number;
  salt: string;
};

export type EncryptedLocalVaultAccount = {
  id: string;
  encryptedPayload: string;
  encryptionVersion: 1;
  revision: number;
};

export type LocalVaultRecord = {
  version: typeof LOCAL_VAULT_RECORD_VERSION;
  profileId: string;
  createdAt: string;
  kdf: LocalVaultKdfParameters;
  wrappedLocalRootKey: string;
  encryptedLocalVaultKey: string;
  encryptedVaultName: string;
  accounts: EncryptedLocalVaultAccount[];
};

export function parseLocalVaultRecord(value: unknown): LocalVaultRecord {
  if (!isRecord(value)) invalid();
  const keys = Object.keys(value).sort().join(",");
  if (keys !== "accounts,createdAt,encryptedLocalVaultKey,encryptedVaultName,kdf,profileId,version,wrappedLocalRootKey")
    invalid();
  if (
    value.version !== LOCAL_VAULT_RECORD_VERSION ||
    !opaque(value.profileId) ||
    !isoTimestamp(value.createdAt) ||
    !base64(value.wrappedLocalRootKey) ||
    !base64(value.encryptedLocalVaultKey) ||
    !base64(value.encryptedVaultName) ||
    !Array.isArray(value.accounts)
  )
    invalid();
  if (value.accounts.length > 500 || !value.accounts.every(isEncryptedAccount)) invalid();
  const kdf = value.kdf;
  if (
    !isRecord(kdf) ||
    Object.keys(kdf).sort().join(",") !== "algorithm,iterations,memoryKiB,parallelism,salt" ||
    kdf.algorithm !== "ARGON2ID" ||
    !positiveInteger(kdf.memoryKiB) ||
    !positiveInteger(kdf.iterations) ||
    !positiveInteger(kdf.parallelism) ||
    !base64(kdf.salt)
  )
    invalid();
  return value as unknown as LocalVaultRecord;
}

function isEncryptedAccount(value: unknown): value is EncryptedLocalVaultAccount {
  if (!isRecord(value) || Object.keys(value).sort().join(",") !== "encryptedPayload,encryptionVersion,id,revision")
    return false;
  return (
    opaque(value.id) &&
    value.encryptionVersion === LOCAL_VAULT_ENCRYPTION_VERSION &&
    base64(value.encryptedPayload) &&
    positiveInteger(value.revision)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function opaque(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{16,128}$/.test(value);
}

function base64(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 4 &&
    value.length <= 8_000_000 &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  );
}

function isoTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" && Number.isFinite(new Date(value).getTime()) && new Date(value).toISOString() === value
  );
}

function invalid(): never {
  throw new Error("Local Vault record is invalid.");
}
