"use client";

import type { ClientCryptoPort } from "@rhasia-scret/client-vault-core";
import {
  decryptPayload,
  decryptPayloadWithContext,
  deserializeEncryptedEnvelope,
  encryptPayload,
  encryptPayloadWithContext,
  generateSymmetricKey,
  serializeEncryptedEnvelope
} from "./browser-crypto-envelope";
import { browserCryptoPrimitives } from "./browser-crypto-primitives";

/** Web composition adapter for protocol crypto. Native composition supplies another ClientCryptoPort. */
export const browserClientCryptoPort: ClientCryptoPort = {
  randomBytes: (length) => browserCryptoPrimitives.randomBytes(length),
  generateSymmetricKey,
  encryptPayload,
  decryptPayload,
  encryptPayloadWithContext,
  decryptPayloadWithContext,
  serializeEncryptedEnvelope,
  deserializeEncryptedEnvelope
};
