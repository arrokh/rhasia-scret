"use client";

import type { CryptoEnvelopeContext } from "@rhasia-scret/client-vault-core";
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

export async function migrateLegacyEncryptedPayload(
  keyBytes: Uint8Array,
  legacyBytes: Uint8Array,
  context: CryptoEnvelopeContext,
): Promise<Uint8Array> {
  const legacy = browserClientCryptoPort.deserializeEncryptedEnvelope(legacyBytes);
  if (legacy.version !== 1) throw new Error("Only legacy envelopes can enter the migration path.");
  const plaintext = await browserClientCryptoPort.decryptPayload(keyBytes, legacy);
  try {
    return browserClientCryptoPort.serializeEncryptedEnvelope(
      await browserClientCryptoPort.encryptPayloadWithContext(keyBytes, plaintext, context),
    );
  } finally {
    plaintext.fill(0);
  }
}
