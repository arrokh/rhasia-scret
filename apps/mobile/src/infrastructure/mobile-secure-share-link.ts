import { sha256 } from "@noble/hashes/sha2.js";
import { Share } from "react-native";
import {
  createSecureShareLink,
  createSecureShareLinkMaterialWithCrypto,
  redeemSecureShareLink,
  redeemSecureShareLinkMaterialWithCrypto,
  SecureShareLinkHttpTransport,
  type AuthenticatedTransport,
  type PortableJsonWebKey,
} from "@rhasia-scret/client-vault-core";
import { nativeClientCrypto } from "./native-client-crypto";

export function createMobileSecureShareLink(
  vault: { id: string; key: Uint8Array; keyVersion: number },
  recipientEmail: string,
  transport: AuthenticatedTransport,
  webOrigin: string,
): Promise<{ expiresAt: string }> {
  const secureShareLinks = new SecureShareLinkHttpTransport(transport);
  return createSecureShareLink(vault.id, recipientEmail, vault.key, vault.keyVersion, {
    crypto: {
      createMaterial: (vaultKey, vaultId) =>
        createSecureShareLinkMaterialWithCrypto(vaultKey, vaultId, nativeClientCrypto, async (value) => sha256(value)),
    },
    transport: secureShareLinks,
    delivery: {
      deliver: async ({ secret }) => {
        const shareResult = await Share.share({ message: `${webOrigin}/vaults/invitations/redeem#${secret}` });
        if (shareResult.action === Share.dismissedAction) throw new Error("Secure Share Link sharing was cancelled.");
      },
    },
  }).then(({ expiresAt }) => ({ expiresAt }));
}

export function redeemMobileSecureShareLink(
  secret: string,
  recipient: { profileId: string; publicKey: PortableJsonWebKey },
  transport: AuthenticatedTransport,
): Promise<void> {
  const secureShareLinks = new SecureShareLinkHttpTransport(transport);
  return redeemSecureShareLink(secret, recipient, {
    crypto: {
      digestSha256: async (value) => sha256(value),
      redeemMaterial: (linkSecret, encryptedPackage, recipientIdentity, vaultId, keyVersion) =>
        redeemSecureShareLinkMaterialWithCrypto(
          linkSecret,
          encryptedPackage,
          recipientIdentity,
          vaultId,
          keyVersion,
          nativeClientCrypto,
          async (value) => sha256(value),
        ),
    },
    transport: secureShareLinks,
  });
}
