import { boundedEncryptedBlobSchema } from "@api/http/validation";
import { z } from "zod";

const digestSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const encryptedPayloadMigrationFields = {
  expectedEnvelopeVersion: z.literal(1),
  replacementEnvelopeVersion: z.literal(2),
  expectedCiphertextDigest: digestSchema,
  replacementCiphertextDigest: digestSchema,
  replacementCiphertext: boundedEncryptedBlobSchema(29),
  operationId: digestSchema,
};

export function hasStableEncryptedPayloadMigrationOperation(migration: {
  replacementCiphertextDigest: string;
  operationId: string;
}): boolean {
  return migration.operationId === migration.replacementCiphertextDigest;
}
