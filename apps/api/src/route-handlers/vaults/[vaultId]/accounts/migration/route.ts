import { getApiRequestContext } from "@api/http/api-context";
import { ApiResponse, type ApiRequest } from "@api/http/api-request";
import {
  encryptedPayloadMigrationFields,
  hasStableEncryptedPayloadMigrationOperation,
} from "@api/http/encrypted-payload-migration";
import { routeParamSchema, safeParseJsonBody } from "@api/http/validation";
import { Buffer } from "@api/shared/infrastructure/base64";
import { type PersonalAccountRepository } from "@api/modules/authenticator-account/server";
import { authenticateApplicationMutation } from "@api/shared/infrastructure/authenticated-application-request";
import { z } from "zod";

const schema = z
  .object({
    ...encryptedPayloadMigrationFields,
    accountId: routeParamSchema,
    expectedRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    expectedKeyVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  })
  .strict()
  .refine(hasStableEncryptedPayloadMigrationOperation);

type Dependencies = {
  authenticate: typeof authenticateApplicationMutation;
  accounts: Pick<PersonalAccountRepository, "migratePayload">;
};
type Context = { params: Promise<{ vaultId: string }> };

export function createPersonalAccountPayloadMigrationHandler({ authenticate, accounts }: Dependencies) {
  return async function POST(request: ApiRequest, { params }: Context) {
    const user = await authenticate(request, "account_mutation", "fresh-provider-user");
    if (user instanceof ApiResponse) return user;
    const parsed = await safeParseJsonBody(request, schema);
    if (!parsed.success) return ApiResponse.json({ error: "invalid_account_migration" }, { status: 400 });
    const { vaultId } = await params;
    const replacementCiphertext = Buffer.from(parsed.data.replacementCiphertext, "base64");
    try {
      const result = await accounts.migratePayload(
        user.id,
        vaultId,
        parsed.data.accountId,
        parsed.data.expectedRevision,
        parsed.data.expectedKeyVersion,
        {
          expectedEnvelopeVersion: parsed.data.expectedEnvelopeVersion,
          replacementEnvelopeVersion: parsed.data.replacementEnvelopeVersion,
          expectedCiphertextDigest: parsed.data.expectedCiphertextDigest,
          replacementCiphertextDigest: parsed.data.replacementCiphertextDigest,
          replacementCiphertext,
          operationId: parsed.data.operationId,
        },
      );
      if (result === "conflict") return ApiResponse.json({ error: "account_migration_conflict" }, { status: 409 });
      return new ApiResponse(null, { status: 204 });
    } finally {
      replacementCiphertext.fill(0);
    }
  };
}

export async function POST(request: ApiRequest, context: Context) {
  return createPersonalAccountPayloadMigrationHandler({
    authenticate: authenticateApplicationMutation,
    accounts: getApiRequestContext(request).applicationRuntime.personalAccounts(),
  })(request, context);
}
