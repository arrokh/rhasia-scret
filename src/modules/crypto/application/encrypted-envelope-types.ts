export type CryptoEnvelopeContext = {
  purpose: string;
  payloadType?: string;
  protocolVersion?: 1;
  vaultId?: string;
  accountId?: string;
  recipientId?: string;
  profileId?: string;
  keyVersion?: number;
  archiveVersion?: number;
};

export type EncryptedEnvelope = {
  version: 1 | 2;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
};

export type KeyWrapEnvelope = EncryptedEnvelope & {
  ephemeralPublicKey: Record<string, unknown>;
};
