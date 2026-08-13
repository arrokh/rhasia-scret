export type SecureShareLinkLookup = {
  id: string;
  vaultId: string;
  encryptedPackage: string;
};

export interface SecureShareLinkTransportPort {
  lookup(verifier: string): Promise<SecureShareLinkLookup>;
  redeem(request: { invitationId: string; encryptedVaultKey: string; keyVersion: 1 }): Promise<void>;
}

export interface SecureShareLinkCryptoPort {
  digestSha256(value: Uint8Array): Promise<Uint8Array>;
  redeemMaterial(secret: string, encryptedPackage: Uint8Array, userRootKey: Uint8Array, vaultId: string): Promise<{ linkVerifier: Uint8Array; encryptedVaultKey: Uint8Array }>;
}

export type SecureShareLinkWorkflowPorts = {
  transport: SecureShareLinkTransportPort;
  crypto: SecureShareLinkCryptoPort;
};
