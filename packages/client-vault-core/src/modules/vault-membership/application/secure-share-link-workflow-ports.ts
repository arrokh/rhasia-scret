import type { PortableJsonWebKey } from "../../crypto/application/crypto-ports";

export type CreatedSecureShareLink = Readonly<{ id: string; expiresAt: string }>;

export type SecureShareLinkLookup = {
  id: string;
  vaultId: string;
  encryptedPackage: string;
  keyVersion: number;
};

export type SecureShareLinkMaterial = {
  secret: string;
  linkVerifier: Uint8Array;
  encryptedPackage: Uint8Array;
};

export interface SecureShareLinkTransportPort {
  lookup(verifier: string): Promise<SecureShareLinkLookup>;
  redeem(request: {
    invitationId: string;
    encryptedVaultKey: string;
    keyVersion: number;
    expectedPublicKey: PortableJsonWebKey;
  }): Promise<void>;
}

export interface SecureShareLinkCreationTransportPort extends SecureShareLinkTransportPort {
  create(
    vaultId: string,
    request: Readonly<{
      recipientEmail: string;
      linkVerifier: string;
      encryptedPackage: string;
      expectedKeyVersion: number;
    }>,
  ): Promise<CreatedSecureShareLink>;
  cancel(vaultId: string, invitationId: string): Promise<void>;
}

export interface SecureShareLinkCreationCryptoPort {
  createMaterial(vaultKey: Uint8Array, vaultId: string): Promise<SecureShareLinkMaterial>;
}

export interface SecureShareLinkDeliveryPort {
  deliver(link: Readonly<{ secret: string; invitationId: string; expiresAt: string }>): Promise<void>;
}

export interface SecureShareLinkCryptoPort {
  digestSha256(value: Uint8Array): Promise<Uint8Array>;
  redeemMaterial(
    secret: string,
    encryptedPackage: Uint8Array,
    recipient: { profileId: string; publicKey: PortableJsonWebKey },
    vaultId: string,
    keyVersion: number,
  ): Promise<{ linkVerifier: Uint8Array; encryptedVaultKey: Uint8Array }>;
}

export type SecureShareLinkWorkflowPorts = {
  transport: SecureShareLinkTransportPort;
  crypto: SecureShareLinkCryptoPort;
};

export type SecureShareLinkCreationPorts = {
  transport: SecureShareLinkCreationTransportPort;
  crypto: SecureShareLinkCreationCryptoPort;
  delivery?: SecureShareLinkDeliveryPort;
};
