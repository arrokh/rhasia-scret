import { base64ToBytes, bytesToBase64, bytesToBase64Url } from "../../../shared/application/base64";
import type { SecureShareLinkWorkflowPorts } from "./secure-share-link-workflow-ports";

export async function redeemSecureShareLink(
  secret: string,
  userRootKey: Uint8Array,
  ports: SecureShareLinkWorkflowPorts
): Promise<void> {
  const verifier = await ports.crypto.digestSha256(new TextEncoder().encode(secret));
  let encryptedPackage: Uint8Array | undefined;
  let material: Awaited<ReturnType<SecureShareLinkWorkflowPorts["crypto"]["redeemMaterial"]>> | undefined;
  try {
    const link = await ports.transport.lookup(bytesToBase64(verifier));
    encryptedPackage = base64ToBytes(link.encryptedPackage);
    material = await ports.crypto.redeemMaterial(secret, encryptedPackage, userRootKey, link.vaultId);
    if (bytesToBase64Url(material.linkVerifier) !== bytesToBase64Url(verifier)) throw new Error("Secure Share Link verifier mismatch.");
    await ports.transport.redeem({ invitationId: link.id, encryptedVaultKey: bytesToBase64(material.encryptedVaultKey), keyVersion: 1 });
  } finally {
    verifier.fill(0);
    encryptedPackage?.fill(0);
    material?.linkVerifier.fill(0);
    material?.encryptedVaultKey.fill(0);
  }
}
