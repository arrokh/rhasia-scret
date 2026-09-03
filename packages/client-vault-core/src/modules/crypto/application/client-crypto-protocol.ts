import { base64ToBytes, base64UrlToBytes, bytesToBase64 } from "../../../shared/application/base64";
import type { ClientCryptoPort, CryptoPrimitivePort, PortableJsonWebKey } from "./crypto-ports";
import type { CryptoEnvelopeContext, EncryptedEnvelope, KeyWrapEnvelope } from "./encrypted-envelope-types";

const legacyVersion = 1;
const currentVersion = 2;
const nonceBytes = 12;
const keyBytes = 32;
const authenticationTagBytes = 16;
const maximumContextBytes = 1_024;
const maximumKeyWrapBytes = 64 * 1_024;
const keyWrapPrefix = new TextEncoder().encode("rhasia-scret:key-wrap:v2:");
const legacyKeyWrapInfo = new TextEncoder().encode("shared-totp-vault:key-wrap:v1");

/** Builds protocol operations over platform-native cryptographic primitives. */
export function createClientCryptoPort(primitives: CryptoPrimitivePort): ClientCryptoPort {
  async function encrypt(
    version: 1 | 2,
    key: Uint8Array,
    plaintext: Uint8Array,
    additionalData?: Uint8Array,
  ): Promise<EncryptedEnvelope> {
    validateKey(key);
    const nonce = primitives.randomBytes(nonceBytes);
    if (nonce.length !== nonceBytes) throw new Error("Crypto provider returned an invalid nonce.");
    const keyCopy = key.slice();
    const nonceCopy = nonce.slice();
    const plaintextCopy = plaintext.slice();
    const additionalDataCopy = additionalData?.slice();
    try {
      const ciphertext = await primitives.encryptAesGcm({
        key: keyCopy,
        nonce: nonceCopy,
        plaintext: plaintextCopy,
        additionalData: additionalDataCopy,
      });
      if (ciphertext.length < authenticationTagBytes) throw new Error("Crypto provider returned invalid ciphertext.");
      return { version, nonce, ciphertext };
    } finally {
      keyCopy.fill(0);
      nonceCopy.fill(0);
      plaintextCopy.fill(0);
      additionalDataCopy?.fill(0);
    }
  }

  async function decrypt(
    key: Uint8Array,
    envelope: EncryptedEnvelope,
    additionalData?: Uint8Array,
  ): Promise<Uint8Array> {
    validateKey(key);
    validateEnvelope(envelope);
    const keyCopy = key.slice();
    const nonceCopy = envelope.nonce.slice();
    const ciphertextCopy = envelope.ciphertext.slice();
    const additionalDataCopy = additionalData?.slice();
    try {
      return await primitives.decryptAesGcm({
        key: keyCopy,
        nonce: nonceCopy,
        ciphertext: ciphertextCopy,
        additionalData: additionalDataCopy,
      });
    } finally {
      keyCopy.fill(0);
      nonceCopy.fill(0);
      ciphertextCopy.fill(0);
      additionalDataCopy?.fill(0);
    }
  }

  async function deriveKey(
    privateKey: PortableJsonWebKey,
    publicKey: PortableJsonWebKey,
    context?: CryptoEnvelopeContext,
  ): Promise<Uint8Array> {
    validatePrivateKey(privateKey);
    validatePublicKey(publicKey);
    const sharedSecret = await primitives.deriveEcdhSharedKey(privateKey, publicKey);
    try {
      if (sharedSecret.length !== keyBytes) throw new Error("Crypto provider returned an invalid ECDH secret.");
      const info = context
        ? concat(keyWrapPrefix, serializeCryptoEnvelopeContext(context))
        : copyBytes(legacyKeyWrapInfo);
      try {
        const ikmCopy = sharedSecret.slice();
        const salt = new Uint8Array();
        try {
          const derived = await primitives.deriveHkdfSha256(ikmCopy, salt, info, keyBytes);
          if (derived.length !== keyBytes) throw new Error("Crypto provider returned an invalid key-wrap key.");
          return derived;
        } finally {
          ikmCopy.fill(0);
          salt.fill(0);
        }
      } finally {
        info.fill(0);
      }
    } finally {
      sharedSecret.fill(0);
    }
  }

  async function wrapKey(
    vaultKey: Uint8Array,
    recipientPublicKey: PortableJsonWebKey,
    context?: CryptoEnvelopeContext,
  ): Promise<KeyWrapEnvelope> {
    validateKey(vaultKey);
    validatePublicKey(recipientPublicKey);
    const ephemeral = await primitives.generateEcdhKeyPair();
    validatePrivateKey(ephemeral.privateKey);
    validatePublicKey(ephemeral.publicKey);
    const sharedKey = await deriveKey(ephemeral.privateKey, recipientPublicKey, context);
    try {
      const encrypted = context
        ? await encrypt(currentVersion, sharedKey, vaultKey, serializeCryptoEnvelopeContext(context))
        : await encrypt(legacyVersion, sharedKey, vaultKey);
      return {
        ...encrypted,
        ephemeralPublicKey: { ...ephemeral.publicKey },
      };
    } finally {
      sharedKey.fill(0);
    }
  }

  async function unwrapKey(
    envelope: KeyWrapEnvelope,
    recipientPrivateKey: PortableJsonWebKey,
    context?: CryptoEnvelopeContext,
  ): Promise<Uint8Array> {
    validateKeyWrapEnvelope(envelope);
    validatePrivateKey(recipientPrivateKey);
    const sharedKey = await deriveKey(recipientPrivateKey, envelope.ephemeralPublicKey, context);
    try {
      return context
        ? await decrypt(sharedKey, envelope, serializeCryptoEnvelopeContext(context))
        : await decrypt(sharedKey, envelope);
    } finally {
      sharedKey.fill(0);
    }
  }

  return {
    randomBytes: (length) => primitives.randomBytes(length),
    generateSymmetricKey: () => {
      const key = primitives.randomBytes(keyBytes);
      if (key.length !== keyBytes) throw new Error("Crypto provider returned an invalid symmetric key.");
      return key;
    },
    encryptPayload: (key, plaintext, additionalData) => encrypt(legacyVersion, key, plaintext, additionalData),
    decryptPayload: (key, envelope, additionalData) => {
      if (envelope.version !== legacyVersion) throw new Error("Context-bound envelope requires an authenticated context.");
      return decrypt(key, envelope, additionalData);
    },
    encryptPayloadWithContext: (key, plaintext, context) => encrypt(currentVersion, key, plaintext, serializeCryptoEnvelopeContext(context)),
    decryptPayloadWithContext: (key, envelope, context) => {
      if (envelope.version !== currentVersion) throw new Error("Legacy envelope requires an explicit migration before use.");
      return decrypt(key, envelope, serializeCryptoEnvelopeContext(context));
    },
    serializeEncryptedEnvelope,
    deserializeEncryptedEnvelope,
    generateUserEncryptionKeyPair: async () => {
      const pair = await primitives.generateEcdhKeyPair();
      validatePublicKey(pair.publicKey);
      validatePrivateKey(pair.privateKey);
      return { publicKey: { ...pair.publicKey }, privateKey: { ...pair.privateKey } };
    },
    wrapKeyForRecipient: (vaultKey, recipientPublicKey) => wrapKey(vaultKey, recipientPublicKey),
    wrapKeyForRecipientWithContext: (vaultKey, recipientPublicKey, context) => wrapKey(vaultKey, recipientPublicKey, context),
    serializeKeyWrapEnvelope,
    deserializeKeyWrapEnvelope,
    unwrapKeyForRecipient: (envelope, recipientPrivateKey) => {
      if (envelope.version !== legacyVersion) throw new Error("Context-bound key package requires an authenticated context.");
      return unwrapKey(envelope, recipientPrivateKey);
    },
    unwrapKeyForRecipientWithContext: (envelope, recipientPrivateKey, context) => {
      if (envelope.version !== currentVersion) throw new Error("Legacy key package requires an explicit migration before use.");
      return unwrapKey(envelope, recipientPrivateKey, context);
    },
  };
}

export function serializeEncryptedEnvelope(envelope: EncryptedEnvelope): Uint8Array {
  validateEnvelope(envelope);
  const bytes = new Uint8Array(1 + nonceBytes + envelope.ciphertext.length);
  bytes[0] = envelope.version;
  bytes.set(envelope.nonce, 1);
  bytes.set(envelope.ciphertext, 1 + nonceBytes);
  return bytes;
}

export function deserializeEncryptedEnvelope(bytes: Uint8Array): EncryptedEnvelope {
  if (bytes.length <= 1 + nonceBytes + authenticationTagBytes || (bytes[0] !== legacyVersion && bytes[0] !== currentVersion)) {
    throw new Error("Unsupported encrypted envelope.");
  }
  return {
    version: bytes[0] as 1 | 2,
    nonce: bytes.slice(1, 1 + nonceBytes),
    ciphertext: bytes.slice(1 + nonceBytes),
  };
}

export function serializeKeyWrapEnvelope(envelope: KeyWrapEnvelope): Uint8Array {
  validateKeyWrapEnvelope(envelope);
  return new TextEncoder().encode(JSON.stringify({
    version: envelope.version,
    nonce: bytesToBase64(envelope.nonce),
    ciphertext: bytesToBase64(envelope.ciphertext),
    ephemeralPublicKey: envelope.ephemeralPublicKey,
  }));
}

export function deserializeKeyWrapEnvelope(bytes: Uint8Array): KeyWrapEnvelope {
  if (bytes.length > maximumKeyWrapBytes) throw new Error("Encrypted key package is invalid.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error("Encrypted key package is invalid.");
  }
  if (!isRecord(parsed) || !hasExactKeys(parsed, ["ciphertext", "ephemeralPublicKey", "nonce", "version"])) {
    throw new Error("Encrypted key package is invalid.");
  }
  if (parsed.version !== legacyVersion && parsed.version !== currentVersion) throw new Error("Encrypted key package is invalid.");
  if (typeof parsed.nonce !== "string" || typeof parsed.ciphertext !== "string" || !isRecord(parsed.ephemeralPublicKey)) {
    throw new Error("Encrypted key package is invalid.");
  }
  try {
    const nonce = base64ToBytes(parsed.nonce);
    const ciphertext = base64ToBytes(parsed.ciphertext);
    const envelope: KeyWrapEnvelope = {
      version: parsed.version,
      nonce,
      ciphertext,
      ephemeralPublicKey: parsed.ephemeralPublicKey,
    };
    validateKeyWrapEnvelope(envelope);
    return envelope;
  } catch {
    throw new Error("Encrypted key package is invalid.");
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
    archiveVersion: context.archiveVersion,
  });
  const bytes = new TextEncoder().encode(canonical);
  if (bytes.length > maximumContextBytes) throw new Error("Encrypted context is too large.");
  return bytes;
}

function validateKey(key: Uint8Array): void {
  if (key.length !== keyBytes) throw new Error("AES-256-GCM requires a 32-byte key.");
}

function validateEnvelope(envelope: EncryptedEnvelope): void {
  if (
    (envelope.version !== legacyVersion && envelope.version !== currentVersion)
    || envelope.nonce.length !== nonceBytes
    || envelope.ciphertext.length < authenticationTagBytes
  ) {
    throw new Error("Unsupported encrypted envelope.");
  }
}

function validateKeyWrapEnvelope(envelope: KeyWrapEnvelope): void {
  validateEnvelope(envelope);
  validatePublicKey(envelope.ephemeralPublicKey);
}

function validatePublicKey(value: PortableJsonWebKey): void {
  if (value.kty !== "EC" || value.crv !== "P-256" || typeof value.x !== "string" || typeof value.y !== "string" || "d" in value) {
    throw new Error("ECDH public key is invalid.");
  }
  validateCoordinate(value.x);
  validateCoordinate(value.y);
}

function validatePrivateKey(value: PortableJsonWebKey): void {
  if (typeof value.d !== "string") throw new Error("ECDH private key is invalid.");
  validatePublicKeyWithoutPrivateCheck(value);
  validateCoordinate(value.d);
}

function validatePublicKeyWithoutPrivateCheck(value: PortableJsonWebKey): void {
  if (value.kty !== "EC" || value.crv !== "P-256" || typeof value.x !== "string" || typeof value.y !== "string") {
    throw new Error("ECDH key material is invalid.");
  }
  validateCoordinate(value.x);
  validateCoordinate(value.y);
}

function validateCoordinate(value: string): void {
  let bytes: Uint8Array;
  try {
    bytes = base64UrlToBytes(value);
  } catch {
    throw new Error("ECDH key material is invalid.");
  }
  if (bytes.length !== keyBytes) throw new Error("ECDH key material is invalid.");
  bytes.fill(0);
}

function validateContext(context: CryptoEnvelopeContext): void {
  if (!context || typeof context.purpose !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(context.purpose)) {
    throw new Error("Encrypted context purpose is invalid.");
  }
  if (context.protocolVersion !== undefined && context.protocolVersion !== 1) {
    throw new Error("Encrypted context protocol version is invalid.");
  }
  for (const value of [context.payloadType, context.vaultId, context.accountId, context.recipientId, context.profileId]) {
    if (value !== undefined && (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,256}$/.test(value))) {
      throw new Error("Encrypted context identifier is invalid.");
    }
  }
  for (const value of [context.keyVersion, context.archiveVersion]) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) {
      throw new Error("Encrypted context version is invalid.");
    }
  }
}

function concat(left: Uint8Array, right: Uint8Array): Uint8Array {
  const result = new Uint8Array(left.length + right.length);
  result.set(left);
  result.set(right, left.length);
  return result;
}

function copyBytes(bytes: Uint8Array): Uint8Array {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}
