"use client";

import { decryptPayload, deserializeEncryptedEnvelope, encryptPayload, generateSymmetricKey, serializeEncryptedEnvelope } from "./browser-crypto-envelope";

const VERSION = 1;

export async function createPasskeyRecoveryPackage(userRootKey: Uint8Array, prfOutput: Uint8Array, prfSalt: Uint8Array): Promise<Uint8Array> {
  const recoveryWrappingKey = generateSymmetricKey();
  const packageData = {
    version: VERSION,
    prfSalt: toBase64(prfSalt),
    encryptedRecoveryWrappingKey: toBase64(serializeEncryptedEnvelope(await encryptPayload(prfOutput, recoveryWrappingKey))),
    encryptedUserRootKey: toBase64(serializeEncryptedEnvelope(await encryptPayload(recoveryWrappingKey, userRootKey)))
  };
  return new TextEncoder().encode(JSON.stringify(packageData));
}

export function passkeyRecoverySalt(packageBytes: Uint8Array): Uint8Array {
  return parsePackage(packageBytes).prfSalt;
}

export async function recoverUserRootKeyFromPasskeyPackage(prfOutput: Uint8Array, packageBytes: Uint8Array): Promise<{ userRootKey: Uint8Array; prfSalt: Uint8Array }> {
  const data = parsePackage(packageBytes);
  const recoveryWrappingKey = await decryptPayload(prfOutput, deserializeEncryptedEnvelope(fromBase64(data.encryptedRecoveryWrappingKey)));
  const userRootKey = await decryptPayload(recoveryWrappingKey, deserializeEncryptedEnvelope(fromBase64(data.encryptedUserRootKey)));
  return { userRootKey, prfSalt: data.prfSalt };
}

function parsePackage(packageBytes: Uint8Array): { prfSalt: Uint8Array; encryptedRecoveryWrappingKey: string; encryptedUserRootKey: string } {
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder().decode(packageBytes)); } catch { throw new Error("Passkey recovery package is invalid."); }
  if (!parsed || typeof parsed !== "object") throw new Error("Passkey recovery package is invalid.");
  const data = parsed as Record<string, unknown>;
  if (data.version !== VERSION || typeof data.prfSalt !== "string" || typeof data.encryptedRecoveryWrappingKey !== "string" || typeof data.encryptedUserRootKey !== "string") throw new Error("Passkey recovery package is invalid.");
  return { prfSalt: fromBase64(data.prfSalt), encryptedRecoveryWrappingKey: data.encryptedRecoveryWrappingKey, encryptedUserRootKey: data.encryptedUserRootKey };
}

function toBase64(bytes: Uint8Array): string { let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary); }
function fromBase64(value: string): Uint8Array { const binary = atob(value); return Uint8Array.from(binary, (character) => character.charCodeAt(0)); }
