"use client";

import { createClientCryptoPort, type ClientCryptoPort } from "@rhasia-scret/client-vault-core";
import { browserCryptoPrimitives } from "./browser-crypto-primitives";

/** Web composition adapter for protocol crypto using browser cryptographic primitives. */
export const browserClientCryptoPort: ClientCryptoPort = createClientCryptoPort(browserCryptoPrimitives);
