import { sha256 } from "@noble/hashes/sha2.js";
import { Share } from "react-native";
import {
  createSecureShareLink,
  createSecureShareLinkMaterialWithCrypto,
  redeemSecureShareLink,
  redeemSecureShareLinkMaterialWithCrypto,
  SecureShareLinkHttpTransport,
  type AuthenticatedTransport,
} from "@rhasia-scret/client-vault-core";
import { nativeClientCrypto } from "./native-client-crypto";

export function createMobileSecureShareLink(
  vault: { id: string; key: Uint8Array },
  recipientEmail: string,
  transport: AuthenticatedTransport,
  webOrigin: string,
): Promise<{ expiresAt: string }> {
  const secureShareLinks = new SecureShareLinkHttpTransport(transport);
  return createSecureShareLink(vault.id, recipientEmail, vault.key, {
    crypto: {
      createMaterial: (vaultKey, vaultId) => createSecureShareLinkMaterialWithCrypto(
        vaultKey,
        vaultId,
        nativeClientCrypto,
        async (value) => sha256(value),
      ),
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
  userRootKey: Uint8Array,
  transport: AuthenticatedTransport,
): Promise<void> {
  const secureShareLinks = new SecureShareLinkHttpTransport(transport);
  return redeemSecureShareLink(secret, userRootKey, {
    crypto: {
      digestSha256: async (value) => sha256(value),
      redeemMaterial: (linkSecret, encryptedPackage, rootKey, vaultId) => redeemSecureShareLinkMaterialWithCrypto(
        linkSecret,
        encryptedPackage,
        rootKey,
        vaultId,
        nativeClientCrypto,
        async (value) => sha256(value),
      ),
    },
    transport: secureShareLinks,
  });
}
