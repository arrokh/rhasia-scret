"use client";

import { base64ToBytes, bytesToBase64 } from "@/shared/infrastructure/browser-base64";
import {
  createClientCryptoPort,
  serializeCryptoEnvelopeContext,
} from "../application/client-crypto-protocol";
import type { CryptoEnvelopeContext, KeyWrapEnvelope } from "../application/encrypted-envelope-types";
import { browserCryptoPrimitives } from "./browser-crypto-primitives";
export type { CryptoEnvelopeContext, EncryptedEnvelope, KeyWrapEnvelope } from "../application/encrypted-envelope-types";
export { serializeCryptoEnvelopeContext } from "../application/client-crypto-protocol";

const LEGACY_VERSION = 1;
const VERSION = 2;
const NONCE_LENGTH = 12;
const AUTHENTICATION_TAG_LENGTH = 16;
const clientCrypto = createClientCryptoPort(browserCryptoPrimitives);

export function generateSymmetricKey(): Uint8Array {
  return clientCrypto.generateSymmetricKey();
}

export const serializeEncryptedEnvelope = clientCrypto.serializeEncryptedEnvelope;
export const deserializeEncryptedEnvelope = clientCrypto.deserializeEncryptedEnvelope;

/** @deprecated Legacy context-free format. Only migration code may use this API. */
export const encryptPayload = clientCrypto.encryptPayload;

/** @deprecated Legacy context-free format. Only migration code and legacy fixtures may use this API. */
export const decryptPayload = clientCrypto.decryptPayload;

export const encryptPayloadWithContext = clientCrypto.encryptPayloadWithContext;
export const decryptPayloadWithContext = clientCrypto.decryptPayloadWithContext;

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
