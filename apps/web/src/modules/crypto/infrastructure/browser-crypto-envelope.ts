"use client";

import { browserClientCryptoPort } from "./browser-client-crypto-port";

export type { CryptoEnvelopeContext, EncryptedEnvelope, KeyWrapEnvelope } from "@rhasia-scret/client-vault-core";
export { serializeCryptoEnvelopeContext } from "@rhasia-scret/client-vault-core";

export function generateSymmetricKey(): Uint8Array {
  return browserClientCryptoPort.generateSymmetricKey();
}

export const serializeEncryptedEnvelope = browserClientCryptoPort.serializeEncryptedEnvelope;
export const deserializeEncryptedEnvelope = browserClientCryptoPort.deserializeEncryptedEnvelope;

/** @deprecated Legacy context-free format. Only migration code may use this API. */
export const encryptPayload = browserClientCryptoPort.encryptPayload;

/** @deprecated Legacy context-free format. Only migration code and legacy fixtures may use this API. */
export const decryptPayload = browserClientCryptoPort.decryptPayload;

export const encryptPayloadWithContext = browserClientCryptoPort.encryptPayloadWithContext;
export const decryptPayloadWithContext = browserClientCryptoPort.decryptPayloadWithContext;

export const generateUserEncryptionKeyPair = browserClientCryptoPort.generateUserEncryptionKeyPair;
export const wrapKeyForRecipient = browserClientCryptoPort.wrapKeyForRecipient;
export const wrapKeyForRecipientWithContext = browserClientCryptoPort.wrapKeyForRecipientWithContext;
export const serializeKeyWrapEnvelope = browserClientCryptoPort.serializeKeyWrapEnvelope;
export const deserializeKeyWrapEnvelope = browserClientCryptoPort.deserializeKeyWrapEnvelope;
export const unwrapKeyForRecipient = browserClientCryptoPort.unwrapKeyForRecipient;
export const unwrapKeyForRecipientWithContext = browserClientCryptoPort.unwrapKeyForRecipientWithContext;
