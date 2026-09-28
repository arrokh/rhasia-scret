import { getApiRequestContext } from "@api/http/api-context";
import { ApiResponse, type ApiRequest } from "@api/http/api-request";
import { routeParamSchema, safeParseJsonBody } from "@api/http/validation";
import {
  encryptedPayloadMigrationFields,
  hasStableEncryptedPayloadMigrationOperation,
} from "@api/http/encrypted-payload-migration";
import { Buffer } from "@api/shared/infrastructure/base64";
import { type PersonalVaultRepository } from "@api/modules/vault-management/server";
import { authenticateApplicationMutation } from "@api/shared/infrastructure/authenticated-application-request";
import { z } from "zod";

const schema = z
  .object({
    ...encryptedPayloadMigrationFields,
    vaultId: routeParamSchema,
    expectedKeyVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  })
  .strict()
  .refine(hasStableEncryptedPayloadMigrationOperation);

type Dependencies = {
  authenticate: typeof authenticateApplicationMutation;
  personalVaults: Pick<PersonalVaultRepository, "migrateName">;
};

export function createPersonalVaultNameMigrationHandler({ authenticate, personalVaults }: Dependencies) {
  return async function POST(request: ApiRequest) {
    const user = await authenticate(request, "vault_mutation", "fresh-provider-user");
    if (user instanceof ApiResponse) return user;
    const parsed = await safeParseJsonBody(request, schema);
    if (!parsed.success) return ApiResponse.json({ error: "invalid_vault_name_migration" }, { status: 400 });
    const replacementCiphertext = Buffer.from(parsed.data.replacementCiphertext, "base64");
    try {
      const result = await personalVaults.migrateName(user.id, parsed.data.vaultId, parsed.data.expectedKeyVersion, {
        expectedEnvelopeVersion: parsed.data.expectedEnvelopeVersion,
        replacementEnvelopeVersion: parsed.data.replacementEnvelopeVersion,
        expectedCiphertextDigest: parsed.data.expectedCiphertextDigest,
        replacementCiphertextDigest: parsed.data.replacementCiphertextDigest,
        replacementCiphertext,
        operationId: parsed.data.operationId,
      });
      if (result === "conflict")
        return ApiResponse.json({ error: "personal_vault_name_migration_conflict" }, { status: 409 });
      return new ApiResponse(null, { status: 204 });
    } finally {
      replacementCiphertext.fill(0);
    }
  };
}

export async function POST(request: ApiRequest) {
  return createPersonalVaultNameMigrationHandler({
    authenticate: authenticateApplicationMutation,
    personalVaults: getApiRequestContext(request).applicationRuntime.personalVaults(),
  })(request);
}
