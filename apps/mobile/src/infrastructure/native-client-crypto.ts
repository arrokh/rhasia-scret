import { createClientCryptoPort } from "../../../../src/modules/crypto/application/client-crypto-protocol";
import { nativeCryptoPrimitives } from "./native-crypto-primitives";

/** Mobile protocol adapter; serialized envelopes remain byte-compatible with the web client. */
export const nativeClientCrypto = createClientCryptoPort(nativeCryptoPrimitives);
