"use client";

import type { HmacGenerator } from "../application/generate-totp";
import type { TotpAlgorithm } from "../domain/totp-configuration";

export class BrowserHmacGenerator implements HmacGenerator {
  public async sign(algorithm: TotpAlgorithm, secret: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
    const key = await crypto.subtle.importKey("raw", copyBytes(secret), { name: "HMAC", hash: algorithm }, false, ["sign"]);
    return new Uint8Array(await crypto.subtle.sign("HMAC", key, copyBytes(message)));
  }
}

function copyBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy;
}
