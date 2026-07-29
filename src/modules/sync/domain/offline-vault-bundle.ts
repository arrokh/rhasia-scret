import type { EffectiveSharedVaultAccountPermissions } from "@/modules/vault-membership";

export const OFFLINE_BUNDLE_SCHEMA_VERSION = 2 as const;
export const OFFLINE_ENCRYPTION_VERSION = 1 as const;

export type EncryptedOfflineAccount = {
  id: string;
  encryptedPayload: string;
  encryptionVersion: 1;
  revision: number;
};

export type EncryptedOfflinePersonalVault = {
  vaultId: string;
  lifecycle: "ACTIVE";
  encryptedName: string;
  encryptionVersion: 1;
  accounts: EncryptedOfflineAccount[];
};

export type EncryptedOfflineSharedVault = {
  vaultId: string;
  lifecycle: "ACTIVE";
  role: "OWNER" | "VIEWER";
  effectiveAccountPermissions: EffectiveSharedVaultAccountPermissions;
  encryptedName: string;
  encryptionVersion: 1;
  encryptedVaultKey: string;
  keyVersion: number;
  accounts: EncryptedOfflineAccount[];
};

export type EncryptedOfflineVaultBundle = {
  schemaVersion: 2;
  profileId: string;
  synchronizedAt: string;
  synchronizationToken: string;
  cryptoProfile: {
    vaultUnlockSalt: string;
    wrappedUserRootKey: string;
    encryptedPersonalVaultKey: string;
    encryptionVersion: 1;
  };
  personalVault: EncryptedOfflinePersonalVault;
  sharedVaults: EncryptedOfflineSharedVault[];
};

export function parseEncryptedOfflineVaultBundle(value: unknown): EncryptedOfflineVaultBundle {
  const bundle = object(value, "Local Vault Snapshot");
  exactKeys(bundle, ["schemaVersion", "profileId", "synchronizedAt", "synchronizationToken", "cryptoProfile", "personalVault", "sharedVaults"], "Local Vault Snapshot");
  const schemaVersion = bundle.schemaVersion;
  if (schemaVersion !== 1 && schemaVersion !== OFFLINE_BUNDLE_SCHEMA_VERSION) invalid("unsupported schema version");
  const profileId = opaqueId(bundle.profileId, "profileId");
  const synchronizedAt = timestamp(bundle.synchronizedAt, "synchronizedAt");
  const synchronizationToken = text(bundle.synchronizationToken, "synchronizationToken", 256);
  const cryptoProfile = parseProfile(bundle.cryptoProfile);
  const personalVault = parsePersonalVault(bundle.personalVault);
  const sharedVaults = array(bundle.sharedVaults, "sharedVaults").map((entry, index) => parseSharedVault(entry, index, schemaVersion));
  const vaultIds = new Set([personalVault.vaultId]);
  for (const vault of sharedVaults) {
    if (vaultIds.has(vault.vaultId)) invalid("duplicate Vault identifier");
    vaultIds.add(vault.vaultId);
  }
  return { schemaVersion: OFFLINE_BUNDLE_SCHEMA_VERSION, profileId, synchronizedAt, synchronizationToken, cryptoProfile, personalVault, sharedVaults };
}

function parseProfile(value: unknown): EncryptedOfflineVaultBundle["cryptoProfile"] {
  const profile = object(value, "cryptoProfile");
  exactKeys(profile, ["vaultUnlockSalt", "wrappedUserRootKey", "encryptedPersonalVaultKey", "encryptionVersion"], "cryptoProfile");
  if (profile.encryptionVersion !== OFFLINE_ENCRYPTION_VERSION) invalid("unsupported profile encryption version");
  return {
    vaultUnlockSalt: base64Blob(profile.vaultUnlockSalt, "vaultUnlockSalt", 16, 16),
    wrappedUserRootKey: encryptedEnvelope(profile.wrappedUserRootKey, "wrappedUserRootKey"),
    encryptedPersonalVaultKey: encryptedEnvelope(profile.encryptedPersonalVaultKey, "encryptedPersonalVaultKey"),
    encryptionVersion: OFFLINE_ENCRYPTION_VERSION
  };
}

function parsePersonalVault(value: unknown): EncryptedOfflinePersonalVault {
  const vault = object(value, "personalVault");
  exactKeys(vault, ["vaultId", "lifecycle", "encryptedName", "encryptionVersion", "accounts"], "personalVault");
  if (vault.lifecycle !== "ACTIVE") invalid("Personal Vault is not active");
  if (vault.encryptionVersion !== OFFLINE_ENCRYPTION_VERSION) invalid("unsupported Personal Vault encryption version");
  return {
    vaultId: opaqueId(vault.vaultId, "personalVault.vaultId"),
    lifecycle: "ACTIVE",
    encryptedName: encryptedEnvelope(vault.encryptedName, "personalVault.encryptedName"),
    encryptionVersion: OFFLINE_ENCRYPTION_VERSION,
    accounts: parseAccounts(vault.accounts, "personalVault.accounts")
  };
}

function parseSharedVault(value: unknown, index: number, schemaVersion: 1 | 2): EncryptedOfflineSharedVault {
  const label = `sharedVaults[${index}]`;
  const vault = object(value, label);
  exactKeys(vault, schemaVersion === 1
    ? ["vaultId", "lifecycle", "role", "encryptedName", "encryptionVersion", "encryptedVaultKey", "keyVersion", "accounts"]
    : ["vaultId", "lifecycle", "role", "effectiveAccountPermissions", "encryptedName", "encryptionVersion", "encryptedVaultKey", "keyVersion", "accounts"], label);
  if (vault.lifecycle !== "ACTIVE") invalid(`${label} is not active`);
  if (vault.role !== "OWNER" && vault.role !== "VIEWER") invalid(`${label}.role is invalid`);
  if (vault.encryptionVersion !== OFFLINE_ENCRYPTION_VERSION) invalid(`unsupported ${label} encryption version`);
  return {
    vaultId: opaqueId(vault.vaultId, `${label}.vaultId`),
    lifecycle: "ACTIVE",
    role: vault.role,
    effectiveAccountPermissions: schemaVersion === 1
      ? legacyEffectivePermissions(vault.role)
      : parseEffectivePermissions(vault.effectiveAccountPermissions, `${label}.effectiveAccountPermissions`),
    encryptedName: encryptedEnvelope(vault.encryptedName, `${label}.encryptedName`),
    encryptionVersion: OFFLINE_ENCRYPTION_VERSION,
    encryptedVaultKey: encryptedEnvelope(vault.encryptedVaultKey, `${label}.encryptedVaultKey`),
    keyVersion: positiveInteger(vault.keyVersion, `${label}.keyVersion`),
    accounts: parseAccounts(vault.accounts, `${label}.accounts`)
  };
}

function parseEffectivePermissions(value: unknown, label: string): EffectiveSharedVaultAccountPermissions {
  const effective = object(value, label);
  exactKeys(effective, ["permissions", "sources"], label);
  const permissions = object(effective.permissions, `${label}.permissions`);
  const sources = object(effective.sources, `${label}.sources`);
  const keys = ["canAddAccounts", "canEditAccounts", "canDeleteAccounts"];
  exactKeys(permissions, keys, `${label}.permissions`);
  exactKeys(sources, keys, `${label}.sources`);
  for (const key of keys) {
    if (typeof permissions[key] !== "boolean") invalid(`${label}.permissions.${key} is invalid`);
    if (sources[key] !== "OWNER" && sources[key] !== "VAULT" && sources[key] !== "MEMBER") invalid(`${label}.sources.${key} is invalid`);
  }
  return {
    permissions: permissions as EffectiveSharedVaultAccountPermissions["permissions"],
    sources: sources as EffectiveSharedVaultAccountPermissions["sources"]
  };
}

function legacyEffectivePermissions(role: "OWNER" | "VIEWER"): EffectiveSharedVaultAccountPermissions {
  const owner = role === "OWNER";
  const source = owner ? "OWNER" as const : "VAULT" as const;
  return {
    permissions: { canAddAccounts: owner, canEditAccounts: owner, canDeleteAccounts: owner },
    sources: { canAddAccounts: source, canEditAccounts: source, canDeleteAccounts: source }
  };
}

function parseAccounts(value: unknown, label: string): EncryptedOfflineAccount[] {
  const ids = new Set<string>();
  return array(value, label).map((entry, index) => {
    const accountLabel = `${label}[${index}]`;
    const account = object(entry, accountLabel);
    exactKeys(account, ["id", "encryptedPayload", "encryptionVersion", "revision"], accountLabel);
    if (account.encryptionVersion !== OFFLINE_ENCRYPTION_VERSION) invalid(`unsupported ${accountLabel} encryption version`);
    const id = opaqueId(account.id, `${accountLabel}.id`);
    if (ids.has(id)) invalid(`duplicate account identifier in ${label}`);
    ids.add(id);
    return {
      id,
      encryptedPayload: encryptedEnvelope(account.encryptedPayload, `${accountLabel}.encryptedPayload`),
      encryptionVersion: OFFLINE_ENCRYPTION_VERSION,
      revision: positiveInteger(account.revision, `${accountLabel}.revision`)
    };
  });
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) invalid(`${label} must be an array`);
  return value;
}

function exactKeys(value: Record<string, unknown>, expected: string[], label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) invalid(`${label} has unexpected or missing fields`);
}

function opaqueId(value: unknown, label: string): string {
  const id = text(value, label, 256);
  if (!/^[A-Za-z0-9_-]+$/.test(id)) invalid(`${label} is not an opaque identifier`);
  return id;
}

function text(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string" || value.length < 1 || value.length > maxLength) invalid(`${label} is invalid`);
  return value;
}

function timestamp(value: unknown, label: string): string {
  const result = text(value, label, 64);
  const parsed = new Date(result);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== result) invalid(`${label} is invalid`);
  return result;
}

function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) invalid(`${label} is invalid`);
  return value;
}

function encryptedEnvelope(value: unknown, label: string): string {
  const blob = base64Blob(value, label, 29);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const firstByte = (alphabet.indexOf(blob[0] ?? "") << 2) | (alphabet.indexOf(blob[1] ?? "") >> 4);
  if (firstByte !== 1 && firstByte !== 2) invalid(`${label} has an unsupported envelope version`);
  return blob;
}

function base64Blob(value: unknown, label: string, minimumBytes: number, maximumBytes = 10_000_000): string {
  const blob = text(value, label, Math.ceil(maximumBytes / 3) * 4);
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(blob)) invalid(`${label} is not canonical base64`);
  const padding = blob.endsWith("==") ? 2 : blob.endsWith("=") ? 1 : 0;
  const byteLength = (blob.length * 3) / 4 - padding;
  if (!Number.isInteger(byteLength) || byteLength < minimumBytes || byteLength > maximumBytes) invalid(`${label} has an invalid byte length`);
  return blob;
}

function invalid(reason: string): never {
  throw new Error(`Invalid encrypted offline bundle: ${reason}.`);
}
