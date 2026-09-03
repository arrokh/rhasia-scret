import type { ClientCryptoPort } from "../../crypto/application/crypto-ports";
import { bytesToBase64Url } from "../../../shared/application/base64";
import type { SecureShareLinkMaterial } from "./secure-share-link-workflow-ports";

export type { SecureShareLinkMaterial } from "./secure-share-link-workflow-ports";

export async function createSecureShareLinkMaterialWithCrypto(
  vaultKey: Uint8Array,
  vaultId: string | undefined,
  crypto: ClientCryptoPort,
  digestSha256: (value: Uint8Array) => Promise<Uint8Array>,
): Promise<SecureShareLinkMaterial> {
  const secretBytes = crypto.generateSymmetricKey();
  let secret: string;
  try {
    secret = bytesToBase64Url(secretBytes);
  } finally {
    secretBytes.fill(0);
  }

  const secretBytesForVerifier = new TextEncoder().encode(secret);
  let linkVerifier: Uint8Array;
  try {
    linkVerifier = await digestSha256(secretBytesForVerifier);
  } finally {
    secretBytesForVerifier.fill(0);
  }

  try {
    const linkSecretBytes = new TextEncoder().encode(`shared-totp-vault:share-link:v1:${secret}`);
    let linkKey: Uint8Array;
    try {
      linkKey = await digestSha256(linkSecretBytes);
    } finally {
      linkSecretBytes.fill(0);
    }
    try {
      return {
        secret,
        linkVerifier,
        encryptedPackage: crypto.serializeEncryptedEnvelope(await crypto.encryptPayloadWithContext(linkKey, vaultKey, {
          purpose: "secure-share-link",
          payloadType: "vault-encryption-key",
          ...(vaultId ? { vaultId } : {}),
          keyVersion: 1,
        })),
      };
    } finally {
      linkKey.fill(0);
    }
  } catch (error) {
    linkVerifier.fill(0);
    throw error;
  }
}
