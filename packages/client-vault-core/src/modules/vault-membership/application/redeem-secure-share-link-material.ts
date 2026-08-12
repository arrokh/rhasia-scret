import type { ClientCryptoPort } from "../../crypto/application/crypto-ports";

export async function redeemSecureShareLinkMaterialWithCrypto(
  secret: string,
  encryptedPackage: Uint8Array,
  userRootKey: Uint8Array,
  vaultId: string | undefined,
  crypto: ClientCryptoPort,
  digestSha256: (value: Uint8Array) => Promise<Uint8Array>,
): Promise<{ linkVerifier: Uint8Array; encryptedVaultKey: Uint8Array }> {
  const linkVerifier = await digestSha256(new TextEncoder().encode(secret));
  const linkKey = await digestSha256(new TextEncoder().encode(`shared-totp-vault:share-link:v1:${secret}`));
  try {
    const envelope = crypto.deserializeEncryptedEnvelope(encryptedPackage);
    if (envelope.version !== 2) throw new Error("Secure Share Link package is invalid.");
    const vaultKey = await crypto.decryptPayloadWithContext(linkKey, envelope, {
      purpose: "secure-share-link",
      payloadType: "vault-encryption-key",
      ...(vaultId ? { vaultId } : {}),
      keyVersion: 1,
    });
    try {
      return {
        linkVerifier,
        encryptedVaultKey: crypto.serializeEncryptedEnvelope(await crypto.encryptPayloadWithContext(userRootKey, vaultKey, {
          purpose: "vault-key-wrap",
          payloadType: "vault-encryption-key",
          ...(vaultId ? { vaultId } : {}),
          keyVersion: 1,
        })),
      };
    } catch (error) {
      linkVerifier.fill(0);
      throw error;
    } finally {
      vaultKey.fill(0);
    }
  } finally {
    linkKey.fill(0);
  }
}
