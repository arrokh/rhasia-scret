import type { CancellationPort } from "../../../shared/application/platform-ports";
import type { CryptoEnvelopeContext, EncryptedEnvelope, KeyWrapEnvelope } from "./encrypted-envelope-types";

export type CryptoEnvelopeBytes = Uint8Array;

export type AesGcmEncryptionRequest = {
  key: Uint8Array;
  nonce: Uint8Array;
  plaintext: Uint8Array;
  additionalData?: Uint8Array;
};

export type AesGcmDecryptionRequest = {
  key: Uint8Array;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
  additionalData?: Uint8Array;
};

/** Minimal primitive surface required by the versioned protocol implementation. */
export interface CryptoPrimitivePort {
  randomBytes(length: number): Uint8Array;
  encryptAesGcm(request: AesGcmEncryptionRequest): Promise<Uint8Array>;
  decryptAesGcm(request: AesGcmDecryptionRequest): Promise<Uint8Array>;
  generateEcdhKeyPair(): Promise<PortableEcdhKeyPair>;
  deriveEcdhSharedKey(privateKey: PortableJsonWebKey, publicKey: PortableJsonWebKey): Promise<Uint8Array>;
  deriveHkdfSha256(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array>;
  signHmac(algorithm: "SHA-1" | "SHA-256" | "SHA-512", key: Uint8Array, message: Uint8Array): Promise<Uint8Array>;
}

/** JWK-shaped data is deliberately plain data so native crypto adapters need no Web Crypto types. */
export type PortableJsonWebKey = Readonly<Record<string, unknown>>;

export type PortableEcdhKeyPair = {
  publicKey: PortableJsonWebKey;
  privateKey: PortableJsonWebKey;
};

export type Argon2idParameters = {
  memoryKiB: number;
  iterations: number;
  parallelism: number;
  outputBytes: number;
};

export interface KeyDerivationPort {
  deriveArgon2id(secret: string, salt: Uint8Array, parameters: Argon2idParameters, signal?: CancellationPort): Promise<Uint8Array>;
}

export type DeviceBoundCapability = {
  supported: boolean;
  kind: "browser-webauthn-prf" | "native-passkey" | "unsupported";
  reason?: "secure-context-required" | "user-verification-unavailable" | "prf-unavailable" | "not-implemented";
};

/** Explicitly reports capability; it must not claim native passkeys are WebAuthn PRF compatible. */
export interface DeviceBoundVerificationPort {
  capability(): Promise<DeviceBoundCapability>;
  enroll(request: DeviceBoundEnrollmentRequest): Promise<DeviceBoundEnrollment>;
  recover(request: DeviceBoundRecoveryRequest): Promise<Uint8Array>;
}

export type DeviceBoundEnrollmentRequest = {
  profileId: string;
  userRootKey: Uint8Array;
  signal?: CancellationPort;
};

export type DeviceBoundEnrollment = {
  enrolledAt: string;
};

export type DeviceBoundRecoveryRequest = {
  profileId: string;
  signal?: CancellationPort;
};

/** High-level protocol operations injected into platform-neutral client workflows. */
export interface ClientCryptoPort {
  randomBytes(length: number): Uint8Array;
  generateSymmetricKey(): Uint8Array;
  encryptPayload(key: Uint8Array, plaintext: Uint8Array, additionalData?: Uint8Array): Promise<EncryptedEnvelope>;
  decryptPayload(key: Uint8Array, envelope: EncryptedEnvelope, additionalData?: Uint8Array): Promise<Uint8Array>;
  encryptPayloadWithContext(key: Uint8Array, plaintext: Uint8Array, context: CryptoEnvelopeContext): Promise<EncryptedEnvelope>;
  decryptPayloadWithContext(key: Uint8Array, envelope: EncryptedEnvelope, context: CryptoEnvelopeContext): Promise<Uint8Array>;
  serializeEncryptedEnvelope(envelope: EncryptedEnvelope): Uint8Array;
  deserializeEncryptedEnvelope(bytes: Uint8Array): EncryptedEnvelope;
  generateUserEncryptionKeyPair(): Promise<PortableEcdhKeyPair>;
  wrapKeyForRecipient(vaultKey: Uint8Array, recipientPublicKey: PortableJsonWebKey): Promise<KeyWrapEnvelope>;
  wrapKeyForRecipientWithContext(vaultKey: Uint8Array, recipientPublicKey: PortableJsonWebKey, context: CryptoEnvelopeContext): Promise<KeyWrapEnvelope>;
  serializeKeyWrapEnvelope(envelope: KeyWrapEnvelope): Uint8Array;
  deserializeKeyWrapEnvelope(bytes: Uint8Array): KeyWrapEnvelope;
  unwrapKeyForRecipient(envelope: KeyWrapEnvelope, recipientPrivateKey: PortableJsonWebKey): Promise<Uint8Array>;
  unwrapKeyForRecipientWithContext(envelope: KeyWrapEnvelope, recipientPrivateKey: PortableJsonWebKey, context: CryptoEnvelopeContext): Promise<Uint8Array>;
}
