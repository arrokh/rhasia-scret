import type { ClientCryptoPort, PortableJsonWebKey } from "../../crypto/application/crypto-ports";
import type { CryptoEnvelopeContext } from "../../crypto/application/encrypted-envelope-types";

export async function redeemSecureShareLinkMaterialWithCrypto(
  secret: string,
  encryptedPackage: Uint8Array,
  recipient: { profileId: string; publicKey: PortableJsonWebKey },
  vaultId: string | undefined,
  keyVersion: number,
  crypto: ClientCryptoPort,
  digestSha256: (value: Uint8Array) => Promise<Uint8Array>,
): Promise<{ linkVerifier: Uint8Array; encryptedVaultKey: Uint8Array }> {
  const secretBytes = new TextEncoder().encode(secret);
  let linkVerifier: Uint8Array | undefined;
  try {
    linkVerifier = await digestSha256(secretBytes);
  } finally {
    secretBytes.fill(0);
  }

  let encryptedVaultKey: Uint8Array | undefined;
  let vaultKey: Uint8Array | undefined;
  let linkKey: Uint8Array | undefined;
  try {
    const linkSecretBytes = new TextEncoder().encode(`shared-totp-vault:share-link:v1:${secret}`);
    try {
      linkKey = await digestSha256(linkSecretBytes);
    } finally {
      linkSecretBytes.fill(0);
    }

    const envelope = crypto.deserializeEncryptedEnvelope(encryptedPackage);
    try {
      if (envelope.version !== 2) throw new Error("Secure Share Link package is invalid.");
      vaultKey = await crypto.decryptPayloadWithContext(linkKey, envelope, {
        purpose: "secure-share-link",
        payloadType: "vault-encryption-key",
        ...(vaultId ? { vaultId } : {}),
        keyVersion: 1,
      });
    } finally {
      envelope.nonce.fill(0);
      envelope.ciphertext.fill(0);
    }
    const context: CryptoEnvelopeContext = {
      purpose: "vault-key-wrap",
      payloadType: "vault-encryption-key",
      ...(vaultId ? { vaultId } : {}),
      recipientId: recipient.profileId,
      keyVersion,
    };
    const wrappedVaultKey = await crypto.wrapKeyForRecipientWithContext(vaultKey, recipient.publicKey, context);
    try {
      encryptedVaultKey = crypto.serializeKeyWrapEnvelope(wrappedVaultKey);
    } finally {
      wrappedVaultKey.nonce.fill(0);
      wrappedVaultKey.ciphertext.fill(0);
    }
    return { linkVerifier, encryptedVaultKey };
  } catch (error) {
    linkVerifier?.fill(0);
    encryptedVaultKey?.fill(0);
    vaultKey?.fill(0);
    throw error;
  } finally {
    linkKey?.fill(0);
  }
}
