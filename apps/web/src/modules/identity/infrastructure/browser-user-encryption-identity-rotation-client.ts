"use client";

import {
  parseBrowserPublicEncryptionKey,
  type BrowserPublicEncryptionKey,
} from "@/shared/infrastructure/browser-public-encryption-key";
import { browserApiClient } from "@/shared/infrastructure/browser-api-client";

export type BrowserUserEncryptionIdentityRotationSnapshot = Readonly<{
  encryptedPrivateKey: string;
  encryptionVersion: 1;
  publicKey: BrowserPublicEncryptionKey;
  memberships: ReadonlyArray<Readonly<{ vaultId: string; keyVersion: number; encryptedVaultKey: string }>>;
}>;
export type BrowserUserEncryptionPublicKey = BrowserPublicEncryptionKey;
export function parseBrowserUserEncryptionPublicKey(value: unknown): BrowserUserEncryptionPublicKey {
  return parseBrowserPublicEncryptionKey(value);
}
export type BrowserUserEncryptionIdentityRotationRequest = {
  expectedPublicKey: BrowserPublicEncryptionKey;
  expectedEncryptedPrivateKey: string;
  expectedEncryptionVersion: 1;
  publicKey: BrowserPublicEncryptionKey;
  encryptedPrivateKey: string;
  encryptionVersion: 1;
  memberships: Array<{
    vaultId: string;
    expectedKeyVersion: number;
    expectedEncryptedVaultKey: string;
    encryptedVaultKey: string;
  }>;
};

export async function loadBrowserUserEncryptionIdentityRotationSnapshot(
  signal?: AbortSignal,
): Promise<BrowserUserEncryptionIdentityRotationSnapshot> {
  const response = await browserApiClient.getJson<unknown>("/api/v1/user-encryption-identity/rotation", {
    cache: "no-store",
    ...(signal ? { signal } : {}),
  });
  return parseSnapshot(response);
}

export function submitBrowserUserEncryptionIdentityRotation(
  request: BrowserUserEncryptionIdentityRotationRequest,
): Promise<void> {
  return browserApiClient.patchEmpty("/api/v1/user-encryption-identity/rotation", request);
}

function parseSnapshot(value: unknown): BrowserUserEncryptionIdentityRotationSnapshot {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["encryptedPrivateKey", "publicKey", "encryptionVersion", "memberships"]) ||
    value.encryptionVersion !== 1 ||
    !isCiphertext(value.encryptedPrivateKey) ||
    !Array.isArray(value.memberships) ||
    value.memberships.length > 500
  )
    return invalidSnapshot();
  return {
    encryptedPrivateKey: value.encryptedPrivateKey,
    encryptionVersion: 1,
    publicKey: parseBrowserPublicEncryptionKey(value.publicKey),
    memberships: value.memberships.map(parseMembership),
  };
}

function parseMembership(value: unknown): BrowserUserEncryptionIdentityRotationSnapshot["memberships"][number] {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["vaultId", "keyVersion", "encryptedVaultKey"]) ||
    !isIdentifier(value.vaultId) ||
    !isPositiveInteger(value.keyVersion) ||
    !isCiphertext(value.encryptedVaultKey)
  )
    return invalidSnapshot();
  return {
    vaultId: value.vaultId,
    keyVersion: value.keyVersion,
    encryptedVaultKey: value.encryptedVaultKey,
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

function invalidSnapshot(): never {
  throw new Error("The User Encryption rotation response is invalid.");
}
