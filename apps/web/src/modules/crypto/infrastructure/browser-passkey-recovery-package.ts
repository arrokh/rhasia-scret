"use client";

import { base64ToBytes, bytesToBase64 } from "@/shared/infrastructure/browser-base64";
import {
  decryptPayloadWithContext,
  deserializeEncryptedEnvelope,
  encryptPayloadWithContext,
  generateSymmetricKey,
  serializeEncryptedEnvelope,
} from "./browser-crypto-envelope";

const VERSION = 1;
const KEY_LENGTH = 32;
const MAX_PACKAGE_BYTES = 4096;
const MAX_ENVELOPE_BYTES = 256;

export async function createPasskeyRecoveryPackage(
  userRootKey: Uint8Array,
  prfOutput: Uint8Array,
  prfSalt: Uint8Array,
): Promise<Uint8Array> {
  requireLength(userRootKey, "User Root Key");
  requireLength(prfOutput, "PRF output");
  requireLength(prfSalt, "PRF salt");
  const recoveryWrappingKey = generateSymmetricKey();
  try {
    const packageData = {
      version: VERSION,
      prfSalt: bytesToBase64(prfSalt),
      encryptedRecoveryWrappingKey: bytesToBase64(
        serializeEncryptedEnvelope(
          await encryptPayloadWithContext(prfOutput, recoveryWrappingKey, {
            purpose: "passkey-recovery-wrap",
            payloadType: "recovery-wrapping-key",
            keyVersion: 1,
          }),
        ),
      ),
      encryptedUserRootKey: bytesToBase64(
        serializeEncryptedEnvelope(
          await encryptPayloadWithContext(recoveryWrappingKey, userRootKey, {
            purpose: "passkey-recovery-root",
            payloadType: "user-root-key",
            keyVersion: 1,
          }),
        ),
      ),
    };
    const encoded = new TextEncoder().encode(JSON.stringify(packageData));
    if (encoded.length > MAX_PACKAGE_BYTES) {
      encoded.fill(0);
      throw new Error("Passkey recovery package is invalid.");
    }
    return encoded;
  } finally {
    recoveryWrappingKey.fill(0);
  }
}

export function passkeyRecoverySalt(packageBytes: Uint8Array): Uint8Array {
  return parsePackage(packageBytes).prfSalt;
}

export async function recoverUserRootKeyFromPasskeyPackage(
  prfOutput: Uint8Array,
  packageBytes: Uint8Array,
): Promise<{ userRootKey: Uint8Array; prfSalt: Uint8Array }> {
  requireLength(prfOutput, "PRF output");
  const data = parsePackage(packageBytes);
  let encryptedWrappingKey: Uint8Array | undefined;
  let encryptedUserRootKey: Uint8Array | undefined;
  let recoveryWrappingKey: Uint8Array | undefined;
  try {
    encryptedWrappingKey = decodeEnvelope(data.encryptedRecoveryWrappingKey);
    encryptedUserRootKey = decodeEnvelope(data.encryptedUserRootKey);
    recoveryWrappingKey = await decryptPayloadWithContext(
      prfOutput,
      deserializeEncryptedEnvelope(encryptedWrappingKey),
      { purpose: "passkey-recovery-wrap", payloadType: "recovery-wrapping-key", keyVersion: 1 },
    );
    requireLength(recoveryWrappingKey, "Recovery Wrapping Key");
    const userRootKey = await decryptPayloadWithContext(
      recoveryWrappingKey,
      deserializeEncryptedEnvelope(encryptedUserRootKey),
      { purpose: "passkey-recovery-root", payloadType: "user-root-key", keyVersion: 1 },
    );
    if (userRootKey.length !== KEY_LENGTH) {
      userRootKey.fill(0);
      throw new Error("Passkey recovery package is invalid.");
    }
    return { userRootKey, prfSalt: data.prfSalt };
  } catch (error) {
    data.prfSalt.fill(0);
    throw error;
  } finally {
    recoveryWrappingKey?.fill(0);
    encryptedWrappingKey?.fill(0);
    encryptedUserRootKey?.fill(0);
  }
}

function parsePackage(packageBytes: Uint8Array): {
  prfSalt: Uint8Array;
  encryptedRecoveryWrappingKey: string;
  encryptedUserRootKey: string;
} {
  if (packageBytes.length === 0 || packageBytes.length > MAX_PACKAGE_BYTES)
    throw new Error("Passkey recovery package is invalid.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(packageBytes));
  } catch {
    throw new Error("Passkey recovery package is invalid.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("Passkey recovery package is invalid.");
  const data = parsed as Record<string, unknown>;
  const expected = ["encryptedRecoveryWrappingKey", "encryptedUserRootKey", "prfSalt", "version"];
  const keys = Object.keys(data).sort();
  if (
    keys.length !== expected.length ||
    keys.some((key, index) => key !== expected[index]) ||
    data.version !== VERSION ||
    typeof data.prfSalt !== "string" ||
    typeof data.encryptedRecoveryWrappingKey !== "string" ||
    typeof data.encryptedUserRootKey !== "string"
  )
    throw new Error("Passkey recovery package is invalid.");
  let prfSalt: Uint8Array;
  try {
    prfSalt = base64ToBytes(data.prfSalt);
  } catch {
    throw new Error("Passkey recovery package is invalid.");
  }
  if (prfSalt.length !== KEY_LENGTH) {
    prfSalt.fill(0);
    throw new Error("Passkey recovery package is invalid.");
  }
  return {
    prfSalt,
    encryptedRecoveryWrappingKey: data.encryptedRecoveryWrappingKey,
    encryptedUserRootKey: data.encryptedUserRootKey,
  };
}

function decodeEnvelope(value: string): Uint8Array {
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(value);
  } catch {
    throw new Error("Passkey recovery package is invalid.");
  }
  if (bytes.length < 29 || bytes.length > MAX_ENVELOPE_BYTES || bytes[0] !== 2) {
    bytes.fill(0);
    throw new Error("Passkey recovery package is invalid.");
  }
  return bytes;
}

function requireLength(value: Uint8Array, label: string): void {
  if (value.length !== KEY_LENGTH) throw new Error(`${label} must be 32 bytes.`);
}
