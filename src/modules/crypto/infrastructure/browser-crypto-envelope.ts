"use client";

import { base64ToBytes, bytesToBase64 } from "@/shared/infrastructure/browser-base64";

const VERSION = 1;
const NONCE_LENGTH = 12;
const KEY_LENGTH = 32;

export type EncryptedEnvelope = {
  version: 1;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
};

export type KeyWrapEnvelope = EncryptedEnvelope & {
  ephemeralPublicKey: JsonWebKey;
};

export function generateSymmetricKey(): Uint8Array {
  return randomBytes(KEY_LENGTH);
}

export function serializeEncryptedEnvelope(envelope: EncryptedEnvelope): Uint8Array {
  if (envelope.version !== VERSION || envelope.nonce.length !== NONCE_LENGTH) throw new Error("Unsupported encrypted envelope.");
  const bytes = new Uint8Array(1 + NONCE_LENGTH + envelope.ciphertext.length);
  bytes[0] = envelope.version;
  bytes.set(envelope.nonce, 1);
  bytes.set(envelope.ciphertext, 1 + NONCE_LENGTH);
  return bytes;
}

export function deserializeEncryptedEnvelope(bytes: Uint8Array): EncryptedEnvelope {
  if (bytes.length <= 1 + NONCE_LENGTH || bytes[0] !== VERSION) throw new Error("Unsupported encrypted envelope.");
  return { version: VERSION, nonce: bytes.slice(1, 1 + NONCE_LENGTH), ciphertext: bytes.slice(1 + NONCE_LENGTH) };
}

export async function encryptPayload(keyBytes: Uint8Array, plaintext: Uint8Array, additionalData?: Uint8Array): Promise<EncryptedEnvelope> {
  const nonce = randomBytes(NONCE_LENGTH);
  const key = await importAesKey(keyBytes, ["encrypt"]);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    aesParameters(nonce, additionalData),
    key,
    copyBytes(plaintext)
  ));
  return { version: VERSION, nonce, ciphertext };
}

export async function decryptPayload(keyBytes: Uint8Array, envelope: EncryptedEnvelope, additionalData?: Uint8Array): Promise<Uint8Array> {
  if (envelope.version !== VERSION || envelope.nonce.length !== NONCE_LENGTH) throw new Error("Unsupported encrypted envelope.");
  const key = await importAesKey(keyBytes, ["decrypt"]);
  try {
    return new Uint8Array(await crypto.subtle.decrypt(aesParameters(envelope.nonce, additionalData), key, copyBytes(envelope.ciphertext)));
  } catch {
    throw new Error("Encrypted envelope authentication failed.");
  }
}

export async function wrapKeyForRecipient(vaultKey: Uint8Array, recipientPublicKey: JsonWebKey): Promise<KeyWrapEnvelope> {
  const recipient = await crypto.subtle.importKey("jwk", recipientPublicKey, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ephemeral = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  if (!("privateKey" in ephemeral) || !("publicKey" in ephemeral)) throw new Error("Could not create ECDH keys.");
  const sharedKey = await deriveSharedKey(ephemeral.privateKey, recipient);
  const encrypted = await encryptPayload(sharedKey, vaultKey);
  return { ...encrypted, ephemeralPublicKey: await crypto.subtle.exportKey("jwk", ephemeral.publicKey) };
}

export function serializeKeyWrapEnvelope(envelope: KeyWrapEnvelope): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ version: envelope.version, nonce: bytesToBase64(envelope.nonce), ciphertext: bytesToBase64(envelope.ciphertext), ephemeralPublicKey: envelope.ephemeralPublicKey }));
}

export function deserializeKeyWrapEnvelope(bytes: Uint8Array): KeyWrapEnvelope {
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error("Encrypted key package is invalid."); }
  if (!parsed || typeof parsed !== "object") throw new Error("Encrypted key package is invalid.");
  const record = parsed as Record<string, unknown>;
  if (record.version !== VERSION || typeof record.nonce !== "string" || typeof record.ciphertext !== "string" || !record.ephemeralPublicKey || typeof record.ephemeralPublicKey !== "object") throw new Error("Encrypted key package is invalid.");
  return { version: VERSION, nonce: base64ToBytes(record.nonce), ciphertext: base64ToBytes(record.ciphertext), ephemeralPublicKey: record.ephemeralPublicKey as JsonWebKey };
}

export async function unwrapKeyForRecipient(envelope: KeyWrapEnvelope, recipientPrivateKey: JsonWebKey): Promise<Uint8Array> {
  const privateKey = await crypto.subtle.importKey("jwk", recipientPrivateKey, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  const ephemeralPublicKey = await crypto.subtle.importKey("jwk", envelope.ephemeralPublicKey, { name: "ECDH", namedCurve: "P-256" }, false, []);
  return decryptPayload(await deriveSharedKey(privateKey, ephemeralPublicKey), envelope);
}

export async function generateUserEncryptionKeyPair(): Promise<CryptoKeyPair> {
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  if (!("privateKey" in pair) || !("publicKey" in pair)) throw new Error("Could not create ECDH keys.");
  return pair;
}

async function deriveSharedKey(privateKey: CryptoKey, publicKey: CryptoKey): Promise<Uint8Array> {
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: publicKey }, privateKey, 256));
  const hkdfKey = await crypto.subtle.importKey("raw", copyBytes(sharedSecret), "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(), info: new TextEncoder().encode("shared-totp-vault:key-wrap:v1") },
    hkdfKey,
    256
  ));
}

async function importAesKey(bytes: Uint8Array, usages: KeyUsage[]): Promise<CryptoKey> {
  if (bytes.length !== KEY_LENGTH) throw new Error("AES-256-GCM requires a 32-byte key.");
  return crypto.subtle.importKey("raw", copyBytes(bytes), "AES-GCM", false, usages);
}

function aesParameters(nonce: Uint8Array, additionalData?: Uint8Array): AesGcmParams {
  return additionalData
    ? { name: "AES-GCM", iv: copyBytes(nonce), additionalData: copyBytes(additionalData), tagLength: 128 }
    : { name: "AES-GCM", iv: copyBytes(nonce), tagLength: 128 };
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
