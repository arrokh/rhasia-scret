import { getApiRequestContext } from "@api/http/api-context";
import { ApiResponse, type ApiRequest } from "@api/http/api-request";
import { safeParseJsonBody } from "@api/http/validation";
import {
  encryptedPayloadMigrationFields,
  hasStableEncryptedPayloadMigrationOperation,
} from "@api/http/encrypted-payload-migration";
import { Buffer } from "@api/shared/infrastructure/base64";
import { type SharedVaultRepository } from "@api/modules/vault-management/server";
import { authenticateApplicationMutation } from "@api/shared/infrastructure/authenticated-application-request";
import { z } from "zod";

const schema = z
  .object({
    ...encryptedPayloadMigrationFields,
    expectedKeyVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  })
  .strict()
  .refine(hasStableEncryptedPayloadMigrationOperation);

type Dependencies = {
  authenticate: typeof authenticateApplicationMutation;
  sharedVaults: Pick<SharedVaultRepository, "migrateName">;
};
type Context = { params: Promise<{ vaultId: string }> };

export function createSharedVaultNameMigrationHandler({ authenticate, sharedVaults }: Dependencies) {
  return async function POST(request: ApiRequest, { params }: Context) {
    const user = await authenticate(request, "vault_mutation", "fresh-provider-user");
    if (user instanceof ApiResponse) return user;
    const parsed = await safeParseJsonBody(request, schema);
    if (!parsed.success) return ApiResponse.json({ error: "invalid_vault_name_migration" }, { status: 400 });
    const { vaultId } = await params;
    const replacementCiphertext = Buffer.from(parsed.data.replacementCiphertext, "base64");
    try {
      const result = await sharedVaults.migrateName(user.id, vaultId, parsed.data.expectedKeyVersion, {
        expectedEnvelopeVersion: parsed.data.expectedEnvelopeVersion,
        replacementEnvelopeVersion: parsed.data.replacementEnvelopeVersion,
        expectedCiphertextDigest: parsed.data.expectedCiphertextDigest,
        replacementCiphertextDigest: parsed.data.replacementCiphertextDigest,
        replacementCiphertext,
        operationId: parsed.data.operationId,
      });
      if (result === "conflict") return ApiResponse.json({ error: "vault_name_migration_conflict" }, { status: 409 });
      return new ApiResponse(null, { status: 204 });
    } finally {
      replacementCiphertext.fill(0);
    }
  };
}

export async function POST(request: ApiRequest, context: Context) {
  return createSharedVaultNameMigrationHandler({
    authenticate: authenticateApplicationMutation,
    sharedVaults: getApiRequestContext(request).applicationRuntime.sharedVaults(),
  })(request, context);
}
