"use client";

import {
  parseBrowserPublicEncryptionKey,
  type BrowserPublicEncryptionKey,
} from "@/shared/infrastructure/browser-public-encryption-key";
import { browserApiClient } from "@/shared/infrastructure/browser-api-client";

export type BrowserVaultKeyRotationSnapshot = Readonly<{
  vaultId: string;
  encryptedName: string;
  encryptionVersion: 1;
  currentKeyVersion: number;
  pendingInvitationCount: number;
  accounts: ReadonlyArray<
    Readonly<{
      id: string;
      encryptedPayload: string;
      encryptionVersion: 1;
      revision: number;
      recoverableDeleted: boolean;
    }>
  >;
  members: ReadonlyArray<Readonly<{ userId: string; publicKey: BrowserPublicEncryptionKey; keyVersion: number }>>;
}>;

export type BrowserVaultKeyRotationRequest = {
  expectedEncryptedName: string;
  encryptedName: string;
  encryptionVersion: 1;
  expectedKeyVersion: number;
  keyVersion: number;
  accounts: Array<{ id: string; revision: number; encryptedPayload: string }>;
  memberPackages: Array<{
    userId: string;
    expectedPublicKey: BrowserPublicEncryptionKey;
    encryptedVaultKey: string;
  }>;
};

export async function loadBrowserVaultKeyRotationSnapshot(
  vaultId: string,
  signal?: AbortSignal,
): Promise<BrowserVaultKeyRotationSnapshot> {
  const response = await browserApiClient.getJson<unknown>(
    `/api/v1/shared-vaults/${encodeURIComponent(vaultId)}/rotation`,
    { cache: "no-store", ...(signal ? { signal } : {}) },
  );
  return parseSnapshot(response);
}

export function submitBrowserVaultKeyRotation(vaultId: string, request: BrowserVaultKeyRotationRequest): Promise<void> {
  return browserApiClient.patchEmpty(`/api/v1/shared-vaults/${encodeURIComponent(vaultId)}/rotation`, request);
}

function parseSnapshot(value: unknown): BrowserVaultKeyRotationSnapshot {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "vaultId",
      "encryptedName",
      "encryptionVersion",
      "currentKeyVersion",
      "pendingInvitationCount",
      "accounts",
      "members",
    ]) ||
    !isIdentifier(value.vaultId) ||
    !isCiphertext(value.encryptedName) ||
    value.encryptionVersion !== 1 ||
    !isPositiveInteger(value.currentKeyVersion) ||
    !isNonNegativeInteger(value.pendingInvitationCount) ||
    !Array.isArray(value.accounts) ||
    value.accounts.length > 500 ||
    !Array.isArray(value.members) ||
    value.members.length < 1 ||
    value.members.length > 500
  )
    return invalidSnapshot();

  return {
    vaultId: value.vaultId,
    encryptedName: value.encryptedName,
    encryptionVersion: 1,
    currentKeyVersion: value.currentKeyVersion,
    pendingInvitationCount: value.pendingInvitationCount,
    accounts: value.accounts.map(parseAccount),
    members: value.members.map(parseMember),
  };
}

function parseAccount(value: unknown): BrowserVaultKeyRotationSnapshot["accounts"][number] {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["id", "encryptedPayload", "encryptionVersion", "revision", "recoverableDeleted"]) ||
    !isIdentifier(value.id) ||
    !isCiphertext(value.encryptedPayload) ||
    value.encryptionVersion !== 1 ||
    !isPositiveInteger(value.revision) ||
    typeof value.recoverableDeleted !== "boolean"
  )
    return invalidSnapshot();
  return {
    id: value.id,
    encryptedPayload: value.encryptedPayload,
    encryptionVersion: 1,
    revision: value.revision,
    recoverableDeleted: value.recoverableDeleted,
  };
}

function parseMember(value: unknown): BrowserVaultKeyRotationSnapshot["members"][number] {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["userId", "publicKey", "keyVersion"]) ||
    !isIdentifier(value.userId) ||
    !isPositiveInteger(value.keyVersion)
  )
    return invalidSnapshot();
  return {
    userId: value.userId,
    publicKey: parseBrowserPublicEncryptionKey(value.publicKey),
    keyVersion: value.keyVersion,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, required: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === required.length && required.every((key) => Object.hasOwn(value, key));
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}

function isCiphertext(value: unknown): value is string {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) return false;
  const bytes = (value.length * 3) / 4 - (value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0);
  return bytes >= 13 && bytes <= 16 * 1024 + 29;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === "number" && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === "number" && value >= 0;
}

function invalidSnapshot(): never {
  throw new Error("The Vault key-rotation response is invalid.");
}
