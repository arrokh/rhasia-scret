import { getApiRequestContext } from "@api/http/api-context";
import { Buffer } from "@api/shared/infrastructure/base64";
import { ApiResponse, type ApiRequest } from "@api/http/api-request";
import { boundedEncryptedBlobSchema, safeParseJsonBody } from "@api/http/validation";
import type { UserCryptoProfileRepository } from "@api/modules/identity/server";
import { authenticateApplicationMutation } from "@api/shared/infrastructure/authenticated-application-request";
import { z } from "zod";

const digestSchema = z.string().regex(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/);
const schema = z
  .object({
    expectedEnvelopeVersion: z.literal(1),
    replacementEnvelopeVersion: z.literal(2),
    userEncryptionKeyVersion: z.number().int().positive(),
    expectedCiphertextDigest: digestSchema,
    replacementCiphertextDigest: digestSchema,
    encryptedPrivateKey: boundedEncryptedBlobSchema(30),
    operationId: digestSchema,
  })
  .strict()
  .superRefine(({ operationId, replacementCiphertextDigest }, context) => {
    if (operationId !== replacementCiphertextDigest) {
      context.addIssue({
        code: "custom",
        path: ["operationId"],
        message: "Migration ID must match the replacement fingerprint.",
      });
    }
  });

type Dependencies = {
  authenticate: typeof authenticateApplicationMutation;
  cryptoProfiles: Pick<UserCryptoProfileRepository, "migrateUserEncryptionPrivateKey">;
};

export function createMigrateUserEncryptionPrivateKeyHandler({ authenticate, cryptoProfiles }: Dependencies) {
  return async function POST(request: ApiRequest) {
    const user = await authenticate(request, "key_material_mutation", "fresh-provider-user");
    if (user instanceof ApiResponse) return user;
    const parsed = await safeParseJsonBody(request, schema);
    if (!parsed.success) return ApiResponse.json({ error: "invalid_identity_migration" }, { status: 400 });

    const encryptedPrivateKey = Buffer.from(parsed.data.encryptedPrivateKey, "base64");
    if (encryptedPrivateKey[0] !== parsed.data.replacementEnvelopeVersion) {
      encryptedPrivateKey.fill(0);
      return ApiResponse.json({ error: "invalid_identity_migration" }, { status: 400 });
    }

    let result: Awaited<ReturnType<UserCryptoProfileRepository["migrateUserEncryptionPrivateKey"]>>;
    try {
      result = await cryptoProfiles.migrateUserEncryptionPrivateKey(user.id, {
        expectedEnvelopeVersion: parsed.data.expectedEnvelopeVersion,
        replacementEnvelopeVersion: parsed.data.replacementEnvelopeVersion,
        userEncryptionKeyVersion: parsed.data.userEncryptionKeyVersion,
        expectedCiphertextDigest: parsed.data.expectedCiphertextDigest,
        replacementCiphertextDigest: parsed.data.replacementCiphertextDigest,
        encryptedPrivateKey,
        operationId: parsed.data.operationId,
      });
    } finally {
      encryptedPrivateKey.fill(0);
    }

    if (result === "conflict") return ApiResponse.json({ error: "identity_migration_conflict" }, { status: 409 });
    return new ApiResponse(null, { status: 204 });
  };
}

export async function POST(request: ApiRequest) {
  return createMigrateUserEncryptionPrivateKeyHandler({
    authenticate: authenticateApplicationMutation,
    cryptoProfiles: getApiRequestContext(request).applicationRuntime.userCryptoProfiles(),
  })(request);
}
