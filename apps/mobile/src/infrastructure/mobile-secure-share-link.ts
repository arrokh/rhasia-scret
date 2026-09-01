import { sha256 } from "@noble/hashes/sha2.js";
import { Share } from "react-native";
import { createSecureShareLinkMaterialWithCrypto } from "@rhasia-scret/client-vault-core";
import { redeemSecureShareLink } from "@rhasia-scret/client-vault-core";
import { redeemSecureShareLinkMaterialWithCrypto } from "@rhasia-scret/client-vault-core";
import type { AuthenticatedTransport } from "@rhasia-scret/client-vault-core";
import { nativeClientCrypto } from "./native-client-crypto";
import { bytesToBase64 } from "@rhasia-scret/client-vault-core";
import { SecureShareLinkHttpTransport } from "@rhasia-scret/client-vault-core";

export async function createMobileSecureShareLink(
  vault: { id: string; key: Uint8Array },
  recipientEmail: string,
  transport: AuthenticatedTransport,
): Promise<{ expiresAt: string }> {
  const material = await createSecureShareLinkMaterialWithCrypto(vault.key, vault.id, nativeClientCrypto, async (value) => sha256(value));
  const secureShareLinks = new SecureShareLinkHttpTransport(transport);
  let createdInvitationId: string | undefined;
  try {
    const result = await secureShareLinks.create(vault.id, {
      recipientEmail,
      linkVerifier: bytesToBase64(material.linkVerifier),
      encryptedPackage: bytesToBase64(material.encryptedPackage)
    });
    createdInvitationId = result.id;
    const shareResult = await Share.share({ message: `https://rhasia-scret.vercel.app/vaults/invitations/redeem#${material.secret}` });
    if (shareResult.action === Share.dismissedAction) throw new Error("Secure Share Link sharing was cancelled.");
    return { expiresAt: result.expiresAt };
  } catch (error) {
    if (createdInvitationId) await secureShareLinks.cancel(vault.id, createdInvitationId).catch(() => undefined);
    throw error;
  } finally {
    material.linkVerifier.fill(0);
    material.encryptedPackage.fill(0);
    material.secret = "";
  }
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
