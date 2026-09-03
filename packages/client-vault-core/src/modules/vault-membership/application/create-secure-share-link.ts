import { bytesToBase64 } from "../../../shared/application/base64";
import type { SecureShareLinkCreationPorts } from "./secure-share-link-workflow-ports";

export async function createSecureShareLink(
  vaultId: string,
  recipientEmail: string,
  vaultKey: Uint8Array,
  ports: SecureShareLinkCreationPorts,
): Promise<{ id: string; secret: string; expiresAt: string }> {
  const material = await ports.crypto.createMaterial(vaultKey, vaultId);
  let invitationId: string | undefined;
  try {
    const invitation = await ports.transport.create(vaultId, {
      recipientEmail,
      linkVerifier: bytesToBase64(material.linkVerifier),
      encryptedPackage: bytesToBase64(material.encryptedPackage),
    });
    invitationId = invitation.id;
    await ports.delivery.deliver({
      secret: material.secret,
      invitationId,
      expiresAt: invitation.expiresAt,
    });
    return { id: invitation.id, secret: material.secret, expiresAt: invitation.expiresAt };
  } catch (error) {
    if (invitationId) await ports.transport.cancel(vaultId, invitationId).catch(() => undefined);
    throw error;
  } finally {
    material.linkVerifier.fill(0);
    material.encryptedPackage.fill(0);
    material.secret = "";
  }
}
