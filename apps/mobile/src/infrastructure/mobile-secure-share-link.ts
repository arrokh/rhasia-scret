import { sha256 } from "@noble/hashes/sha2.js";
import { Share } from "react-native";
import { createSecureShareLinkMaterialWithCrypto } from "../../../../src/modules/vault-membership/application/create-secure-share-link-material";
import { redeemSecureShareLink } from "../../../../src/modules/vault-membership/application/redeem-secure-share-link";
import { redeemSecureShareLinkMaterialWithCrypto } from "../../../../src/modules/vault-membership/application/redeem-secure-share-link-material";
import type { AuthenticatedTransport } from "../../../../src/shared/application/platform-ports";
import { nativeClientCrypto } from "./native-client-crypto";
import { bytesToBase64 } from "../../../../src/shared/application/base64";

export async function createMobileSecureShareLink(
  vault: { id: string; key: Uint8Array },
  recipientEmail: string,
  transport: AuthenticatedTransport,
): Promise<{ expiresAt: string }> {
  const material = await createSecureShareLinkMaterialWithCrypto(vault.key, vault.id, nativeClientCrypto, async (value) => sha256(value));
  let createdInvitationId: string | undefined;
  try {
    const response = await transport.request({
      url: `/api/shared-vaults/${encodeURIComponent(vault.id)}/share-links`,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        recipientEmail: recipientEmail.trim().toLowerCase(),
        linkVerifier: bytesToBase64(material.linkVerifier),
        encryptedPackage: bytesToBase64(material.encryptedPackage),
      }),
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Secure Share Link could not be created.");
    const result = await response.json<unknown>();
    if (!isCreatedLink(result)) throw new Error("Secure Share Link response is invalid.");
    createdInvitationId = result.id;
    const shareResult = await Share.share({ message: `https://rhasia-scret.vercel.app/vaults/invitations/redeem#${material.secret}` });
    if (shareResult.action === Share.dismissedAction) throw new Error("Secure Share Link sharing was cancelled.");
    return { expiresAt: result.expiresAt };
  } catch (error) {
    if (createdInvitationId) await revokeSecureShareLink(vault.id, createdInvitationId, transport).catch(() => undefined);
    throw error;
  } finally {
    material.linkVerifier.fill(0);
    material.encryptedPackage.fill(0);
    material.secret = "";
  }
}

async function revokeSecureShareLink(vaultId: string, invitationId: string, transport: AuthenticatedTransport): Promise<void> {
  const response = await transport.request({
    url: `/api/shared-vaults/${encodeURIComponent(vaultId)}/share-links/${encodeURIComponent(invitationId)}`,
    method: "DELETE",
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Cancelled Secure Share Link could not be revoked.");
}

export function redeemMobileSecureShareLink(
  secret: string,
  userRootKey: Uint8Array,
  transport: AuthenticatedTransport,
): Promise<void> {
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
    transport: {
      lookup: async (verifier) => {
        const response = await transport.request({
          url: `/api/secure-share-links?verifier=${encodeURIComponent(verifier)}`,
          method: "GET",
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Secure Share Link is unavailable.");
        const value = await response.json<unknown>();
        if (!isLookup(value)) throw new Error("Secure Share Link response is invalid.");
        return value;
      },
      redeem: async (request) => {
        const response = await transport.request({
          url: "/api/secure-share-links",
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Secure Share Link could not be redeemed.");
      },
    },
  });
}

function isCreatedLink(value: unknown): value is { id: string; expiresAt: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === "string"
    && typeof record.expiresAt === "string"
    && Number.isFinite(new Date(record.expiresAt).getTime());
}

function isLookup(value: unknown): value is { id: string; vaultId: string; encryptedPackage: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === "string"
    && typeof record.vaultId === "string"
    && typeof record.encryptedPackage === "string";
}
