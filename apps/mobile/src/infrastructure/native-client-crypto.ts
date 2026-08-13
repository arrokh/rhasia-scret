import { createClientCryptoPort } from "@rhasia-scret/client-vault-core";
import { nativeCryptoPrimitives } from "./native-crypto-primitives";

/** Mobile protocol adapter; serialized envelopes remain byte-compatible with the web client. */
export const nativeClientCrypto = createClientCryptoPort(nativeCryptoPrimitives);
