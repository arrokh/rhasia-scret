"use client";

import { base64ToBytes, bytesToBase64 } from "@/shared/infrastructure/browser-base64";
import { decryptPayload, deserializeEncryptedEnvelope, encryptPayload, generateSymmetricKey, serializeEncryptedEnvelope } from "./browser-crypto-envelope";

const VERSION = 1;

export async function createPasskeyRecoveryPackage(userRootKey: Uint8Array, prfOutput: Uint8Array, prfSalt: Uint8Array): Promise<Uint8Array> {
  const recoveryWrappingKey = generateSymmetricKey();
  try {
    const packageData = {
      version: VERSION,
      prfSalt: bytesToBase64(prfSalt),
      encryptedRecoveryWrappingKey: bytesToBase64(serializeEncryptedEnvelope(await encryptPayload(prfOutput, recoveryWrappingKey))),
      encryptedUserRootKey: bytesToBase64(serializeEncryptedEnvelope(await encryptPayload(recoveryWrappingKey, userRootKey)))
    };
    return new TextEncoder().encode(JSON.stringify(packageData));
  } finally {
    recoveryWrappingKey.fill(0);
  }
}

export function passkeyRecoverySalt(packageBytes: Uint8Array): Uint8Array {
  return parsePackage(packageBytes).prfSalt;
}

export async function recoverUserRootKeyFromPasskeyPackage(prfOutput: Uint8Array, packageBytes: Uint8Array): Promise<{ userRootKey: Uint8Array; prfSalt: Uint8Array }> {
  const data = parsePackage(packageBytes);
  const recoveryWrappingKey = await decryptPayload(prfOutput, deserializeEncryptedEnvelope(base64ToBytes(data.encryptedRecoveryWrappingKey)));
  try {
    const userRootKey = await decryptPayload(recoveryWrappingKey, deserializeEncryptedEnvelope(base64ToBytes(data.encryptedUserRootKey)));
    return { userRootKey, prfSalt: data.prfSalt };
  } finally {
    recoveryWrappingKey.fill(0);
  }
}

function parsePackage(packageBytes: Uint8Array): { prfSalt: Uint8Array; encryptedRecoveryWrappingKey: string; encryptedUserRootKey: string } {
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder().decode(packageBytes)); } catch { throw new Error("Passkey recovery package is invalid."); }
  if (!parsed || typeof parsed !== "object") throw new Error("Passkey recovery package is invalid.");
  const data = parsed as Record<string, unknown>;
  if (data.version !== VERSION || typeof data.prfSalt !== "string" || typeof data.encryptedRecoveryWrappingKey !== "string" || typeof data.encryptedUserRootKey !== "string") throw new Error("Passkey recovery package is invalid.");
  return { prfSalt: base64ToBytes(data.prfSalt), encryptedRecoveryWrappingKey: data.encryptedRecoveryWrappingKey, encryptedUserRootKey: data.encryptedUserRootKey };
}
