"use client";

import { base64ToBytes, bytesToBase64 } from "@/shared/infrastructure/browser-base64";
import type { CryptoEnvelopeContext, EncryptedEnvelope, KeyWrapEnvelope } from "../application/encrypted-envelope-types";
export type { CryptoEnvelopeContext, EncryptedEnvelope, KeyWrapEnvelope } from "../application/encrypted-envelope-types";

const LEGACY_VERSION = 1;
const VERSION = 2;
const NONCE_LENGTH = 12;
const KEY_LENGTH = 32;
const AUTHENTICATION_TAG_LENGTH = 16;
const MAX_CONTEXT_BYTES = 1024;

export function generateSymmetricKey(): Uint8Array {
  return randomBytes(KEY_LENGTH);
}

export function serializeEncryptedEnvelope(envelope: EncryptedEnvelope): Uint8Array {
  if ((envelope.version !== LEGACY_VERSION && envelope.version !== VERSION) || envelope.nonce.length !== NONCE_LENGTH || envelope.ciphertext.length < AUTHENTICATION_TAG_LENGTH) throw new Error("Unsupported encrypted envelope.");
  const bytes = new Uint8Array(1 + NONCE_LENGTH + envelope.ciphertext.length);
  bytes[0] = envelope.version;
  bytes.set(envelope.nonce, 1);
  bytes.set(envelope.ciphertext, 1 + NONCE_LENGTH);
  return bytes;
}

export function deserializeEncryptedEnvelope(bytes: Uint8Array): EncryptedEnvelope {
  if (bytes.length <= 1 + NONCE_LENGTH + AUTHENTICATION_TAG_LENGTH || (bytes[0] !== LEGACY_VERSION && bytes[0] !== VERSION)) throw new Error("Unsupported encrypted envelope.");
  return { version: bytes[0] as 1 | 2, nonce: bytes.slice(1, 1 + NONCE_LENGTH), ciphertext: bytes.slice(1 + NONCE_LENGTH) };
}

/** @deprecated Legacy context-free format. Only migration code may use this API. */
export async function encryptPayload(keyBytes: Uint8Array, plaintext: Uint8Array, additionalData?: Uint8Array): Promise<EncryptedEnvelope> {
  return encryptRaw(LEGACY_VERSION, keyBytes, plaintext, additionalData);
}

/** @deprecated Legacy context-free format. Only migration code and legacy fixtures may use this API. */
export async function decryptPayload(keyBytes: Uint8Array, envelope: EncryptedEnvelope, additionalData?: Uint8Array): Promise<Uint8Array> {
  if (envelope.version !== LEGACY_VERSION) throw new Error("Context-bound envelope requires an authenticated context.");
  return decryptRaw(keyBytes, envelope, additionalData);
}

export async function encryptPayloadWithContext(keyBytes: Uint8Array, plaintext: Uint8Array, context: CryptoEnvelopeContext): Promise<EncryptedEnvelope> {
  return encryptRaw(VERSION, keyBytes, plaintext, serializeCryptoEnvelopeContext(context));
}

export async function decryptPayloadWithContext(keyBytes: Uint8Array, envelope: EncryptedEnvelope, context: CryptoEnvelopeContext): Promise<Uint8Array> {
  if (envelope.version !== VERSION) throw new Error("Legacy envelope requires an explicit migration before use.");
  return decryptRaw(keyBytes, envelope, serializeCryptoEnvelopeContext(context));
}

export async function migrateLegacyEncryptedPayload(keyBytes: Uint8Array, legacyBytes: Uint8Array, context: CryptoEnvelopeContext): Promise<Uint8Array> {
  const legacy = deserializeEncryptedEnvelope(legacyBytes);
  if (legacy.version !== LEGACY_VERSION) throw new Error("Only legacy envelopes can enter the migration path.");
  const plaintext = await decryptPayload(keyBytes, legacy);
  try {
    return serializeEncryptedEnvelope(await encryptPayloadWithContext(keyBytes, plaintext, context));
  } finally {
    plaintext.fill(0);
  }
}

export function serializeCryptoEnvelopeContext(context: CryptoEnvelopeContext): Uint8Array {
  validateContext(context);
  const canonical = JSON.stringify({
    protocolVersion: 1,
    purpose: context.purpose,
    payloadType: context.payloadType,
    vaultId: context.vaultId,
    accountId: context.accountId,
    recipientId: context.recipientId,
    profileId: context.profileId,
    keyVersion: context.keyVersion,
    archiveVersion: context.archiveVersion
  });
  const bytes = new TextEncoder().encode(canonical);
  if (bytes.length > MAX_CONTEXT_BYTES) throw new Error("Encrypted context is too large.");
  return bytes;
}

export async function wrapKeyForRecipient(vaultKey: Uint8Array, recipientPublicKey: JsonWebKey): Promise<KeyWrapEnvelope> {
  return wrapKey(vaultKey, recipientPublicKey);
}

export async function wrapKeyForRecipientWithContext(vaultKey: Uint8Array, recipientPublicKey: JsonWebKey, context: CryptoEnvelopeContext): Promise<KeyWrapEnvelope> {
  return wrapKey(vaultKey, recipientPublicKey, context);
}

export function serializeKeyWrapEnvelope(envelope: KeyWrapEnvelope): Uint8Array {
  if (envelope.version !== LEGACY_VERSION && envelope.version !== VERSION) throw new Error("Unsupported encrypted key package.");
  return new TextEncoder().encode(JSON.stringify({ version: envelope.version, nonce: bytesToBase64(envelope.nonce), ciphertext: bytesToBase64(envelope.ciphertext), ephemeralPublicKey: envelope.ephemeralPublicKey }));
}

export function deserializeKeyWrapEnvelope(bytes: Uint8Array): KeyWrapEnvelope {
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { throw new Error("Encrypted key package is invalid."); }
  if (!parsed || typeof parsed !== "object") throw new Error("Encrypted key package is invalid.");
  const record = parsed as Record<string, unknown>;
  if ((record.version !== LEGACY_VERSION && record.version !== VERSION) || typeof record.nonce !== "string" || typeof record.ciphertext !== "string" || !record.ephemeralPublicKey || typeof record.ephemeralPublicKey !== "object") throw new Error("Encrypted key package is invalid.");
  const nonce = base64ToBytes(record.nonce);
  const ciphertext = base64ToBytes(record.ciphertext);
  if (nonce.length !== NONCE_LENGTH || ciphertext.length < AUTHENTICATION_TAG_LENGTH) throw new Error("Encrypted key package is invalid.");
  return { version: record.version, nonce, ciphertext, ephemeralPublicKey: record.ephemeralPublicKey as Record<string, unknown> };
}

export async function unwrapKeyForRecipient(envelope: KeyWrapEnvelope, recipientPrivateKey: JsonWebKey): Promise<Uint8Array> {
  if (envelope.version !== LEGACY_VERSION) throw new Error("Context-bound key package requires an authenticated context.");
  return unwrapKey(envelope, recipientPrivateKey);
}

export async function unwrapKeyForRecipientWithContext(envelope: KeyWrapEnvelope, recipientPrivateKey: JsonWebKey, context: CryptoEnvelopeContext): Promise<Uint8Array> {
  if (envelope.version !== VERSION) throw new Error("Legacy key package requires an explicit migration before use.");
  return unwrapKey(envelope, recipientPrivateKey, context);
}

export async function generateUserEncryptionKeyPair(): Promise<CryptoKeyPair> {
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  if (!("privateKey" in pair) || !("publicKey" in pair)) throw new Error("Could not create ECDH keys.");
  return pair;
}

async function wrapKey(vaultKey: Uint8Array, recipientPublicKey: JsonWebKey, context?: CryptoEnvelopeContext): Promise<KeyWrapEnvelope> {
  const recipient = await crypto.subtle.importKey("jwk", recipientPublicKey, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ephemeral = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  if (!("privateKey" in ephemeral) || !("publicKey" in ephemeral)) throw new Error("Could not create ECDH keys.");
  const sharedKey = await deriveSharedKey(ephemeral.privateKey, recipient, context);
  try {
    const encrypted = context ? await encryptPayloadWithContext(sharedKey, vaultKey, context) : await encryptPayload(sharedKey, vaultKey);
    return { ...encrypted, ephemeralPublicKey: await crypto.subtle.exportKey("jwk", ephemeral.publicKey) as unknown as Record<string, unknown> };
  } finally {
    sharedKey.fill(0);
  }
}

async function unwrapKey(envelope: KeyWrapEnvelope, recipientPrivateKey: JsonWebKey, context?: CryptoEnvelopeContext): Promise<Uint8Array> {
  const privateKey = await crypto.subtle.importKey("jwk", recipientPrivateKey, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  const ephemeralPublicKey = await crypto.subtle.importKey("jwk", envelope.ephemeralPublicKey as JsonWebKey, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const sharedKey = await deriveSharedKey(privateKey, ephemeralPublicKey, context);
  try {
    return context ? await decryptPayloadWithContext(sharedKey, envelope, context) : await decryptPayload(sharedKey, envelope);
  } finally {
    sharedKey.fill(0);
  }
}

async function deriveSharedKey(privateKey: CryptoKey, publicKey: CryptoKey, context?: CryptoEnvelopeContext): Promise<Uint8Array> {
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: publicKey }, privateKey, 256));
  try {
    const hkdfKey = await crypto.subtle.importKey("raw", copyBytes(sharedSecret), "HKDF", false, ["deriveBits"]);
    return new Uint8Array(await crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(), info: context ? concat(new TextEncoder().encode("rhasia-scret:key-wrap:v2:"), serializeCryptoEnvelopeContext(context)) : new TextEncoder().encode("shared-totp-vault:key-wrap:v1") },
      hkdfKey,
      256
    ));
  } finally {
    sharedSecret.fill(0);
  }
}

async function encryptRaw(version: 1 | 2, keyBytes: Uint8Array, plaintext: Uint8Array, additionalData?: Uint8Array): Promise<EncryptedEnvelope> {
  const nonce = randomBytes(NONCE_LENGTH);
  const key = await importAesKey(keyBytes, ["encrypt"]);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(aesParameters(nonce, additionalData), key, copyBytes(plaintext)));
  return { version, nonce, ciphertext };
}

async function decryptRaw(keyBytes: Uint8Array, envelope: EncryptedEnvelope, additionalData?: Uint8Array): Promise<Uint8Array> {
  if ((envelope.version !== LEGACY_VERSION && envelope.version !== VERSION) || envelope.nonce.length !== NONCE_LENGTH || envelope.ciphertext.length < AUTHENTICATION_TAG_LENGTH) throw new Error("Unsupported encrypted envelope.");
  const key = await importAesKey(keyBytes, ["decrypt"]);
  try {
    return new Uint8Array(await crypto.subtle.decrypt(aesParameters(envelope.nonce, additionalData), key, copyBytes(envelope.ciphertext)));
  } catch {
    throw new Error("Encrypted envelope authentication failed.");
  }
}

function validateContext(context: CryptoEnvelopeContext): void {
  if (!context || typeof context.purpose !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(context.purpose)) throw new Error("Encrypted context purpose is invalid.");
  if (context.protocolVersion !== undefined && context.protocolVersion !== 1) throw new Error("Encrypted context protocol version is invalid.");
  for (const value of [context.payloadType, context.vaultId, context.accountId, context.recipientId, context.profileId]) if (value !== undefined && (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,256}$/.test(value))) throw new Error("Encrypted context identifier is invalid.");
  for (const value of [context.keyVersion, context.archiveVersion]) if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) throw new Error("Encrypted context version is invalid.");
}

function aesParameters(nonce: Uint8Array, additionalData?: Uint8Array): AesGcmParams {
  return additionalData ? { name: "AES-GCM", iv: copyBytes(nonce), additionalData: copyBytes(additionalData), tagLength: 128 } : { name: "AES-GCM", iv: copyBytes(nonce), tagLength: 128 };
}

async function importAesKey(bytes: Uint8Array, usages: KeyUsage[]): Promise<CryptoKey> {
  if (bytes.length !== KEY_LENGTH) throw new Error("AES-256-GCM requires a 32-byte key.");
  return crypto.subtle.importKey("raw", copyBytes(bytes), "AES-GCM", false, usages);
}

function concat(left: Uint8Array, right: Uint8Array): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(new ArrayBuffer(left.length + right.length));
  result.set(left);
  result.set(right, left.length);
  return result;
}

function copyBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy;
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}
