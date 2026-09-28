"use client";

import type { Sha256DigestPort } from "@rhasia-scret/client-vault-core";

export const browserSha256Digest: Sha256DigestPort = {
  async digestSha256(message) {
    const copy = message.slice();
    try {
      return new Uint8Array(await crypto.subtle.digest("SHA-256", copy));
    } finally {
      copy.fill(0);
    }
  },
};
