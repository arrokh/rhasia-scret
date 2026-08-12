import type { ClientCryptoPort } from "@/modules/crypto/application/crypto-ports";
import { bytesToBase64Url } from "@/shared/application/base64";

export type SecureShareLinkMaterial = {
  secret: string;
  linkVerifier: Uint8Array;
  encryptedPackage: Uint8Array;
};

export async function createSecureShareLinkMaterialWithCrypto(
  vaultKey: Uint8Array,
  vaultId: string | undefined,
  crypto: ClientCryptoPort,
  digestSha256: (value: Uint8Array) => Promise<Uint8Array>,
): Promise<SecureShareLinkMaterial> {
  const secretBytes = crypto.generateSymmetricKey();
  const secret = bytesToBase64Url(secretBytes);
  secretBytes.fill(0);
  const linkVerifier = await digestSha256(new TextEncoder().encode(secret));
  const linkKey = await digestSha256(new TextEncoder().encode(`shared-totp-vault:share-link:v1:${secret}`));
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
  } catch (error) {
    linkVerifier.fill(0);
    throw error;
  } finally {
    linkKey.fill(0);
  }
}
