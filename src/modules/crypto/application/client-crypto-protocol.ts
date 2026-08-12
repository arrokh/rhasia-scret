import type { ClientCryptoPort, CryptoPrimitivePort } from "./crypto-ports";
import type { CryptoEnvelopeContext, EncryptedEnvelope } from "./encrypted-envelope-types";

const legacyVersion = 1;
const currentVersion = 2;
const nonceBytes = 12;
const keyBytes = 32;
const authenticationTagBytes = 16;
const maximumContextBytes = 1_024;

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
    const ciphertext = await primitives.encryptAesGcm({
      key: key.slice(),
      nonce: nonce.slice(),
      plaintext: plaintext.slice(),
      additionalData: additionalData?.slice(),
    });
    if (ciphertext.length < authenticationTagBytes) throw new Error("Crypto provider returned invalid ciphertext.");
    return { version, nonce, ciphertext };
  }

  async function decrypt(
    key: Uint8Array,
    envelope: EncryptedEnvelope,
    additionalData?: Uint8Array,
  ): Promise<Uint8Array> {
    validateKey(key);
    validateEnvelope(envelope);
    return primitives.decryptAesGcm({
      key: key.slice(),
      nonce: envelope.nonce.slice(),
      ciphertext: envelope.ciphertext.slice(),
      additionalData: additionalData?.slice(),
    });
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
