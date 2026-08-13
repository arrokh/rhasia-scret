"use client";

import type { HmacGenerator } from "@rhasia-scret/client-vault-core";
import type { TotpAlgorithm } from "@rhasia-scret/client-vault-core";
import { browserCryptoPrimitives } from "@/modules/crypto";

export class BrowserHmacGenerator implements HmacGenerator {
  public sign(algorithm: TotpAlgorithm, secret: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
    return browserCryptoPrimitives.signHmac(algorithm, secret, message);
  }
}
