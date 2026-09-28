export type EncryptedPayloadMigration = {
  expectedEnvelopeVersion: 1;
  replacementEnvelopeVersion: 2;
  expectedCiphertextDigest: string;
  replacementCiphertextDigest: string;
  replacementCiphertext: Uint8Array;
  operationId: string;
};

export type EncryptedPayloadMigrationResult = "committed" | "already-committed" | "conflict";
