"use client";

import type { CancellationPort, PortableJsonWebKey } from "@rhasia-scret/client-vault-core";
import { bytesToBase64 } from "@rhasia-scret/client-vault-core";
import { browserApiClient } from "@/shared/infrastructure/browser-api-client";

export async function registerUserEncryptionIdentity(
  identity: {
    publicKey: PortableJsonWebKey;
    encryptedPrivateKey: Uint8Array;
    encryptionVersion: 1;
  },
  signal?: CancellationPort,
): Promise<boolean> {
  const response = await browserApiClient.requestPlatform({
    url: "/v1/user-encryption-identity",
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      publicKey: identity.publicKey,
      encryptedPrivateKey: bytesToBase64(identity.encryptedPrivateKey),
      encryptionVersion: identity.encryptionVersion,
    }),
    cache: "no-store",
    ...(signal ? { signal } : {}),
  });
  if (response.status === 204) return true;
  if (response.status === 409) return false;
  throw new Error("User Encryption Identity registration failed.");
}
