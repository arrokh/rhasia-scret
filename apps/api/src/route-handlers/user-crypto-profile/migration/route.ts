import { getApiRequestContext } from "@api/http/api-context";
import { Buffer } from "@api/shared/infrastructure/base64";
import { ApiResponse, type ApiRequest } from "@api/http/api-request";
import { boundedEncryptedBlobSchema, safeParseJsonBody } from "@api/http/validation";
import { z } from "zod";
import { type UserCryptoProfileRepository } from "@api/modules/identity/server";
import { authenticateApplicationMutation } from "@api/shared/infrastructure/authenticated-application-request";

const wrapperMigrationSchema = z
  .object({
    expectedCiphertext: boundedEncryptedBlobSchema(29),
    replacementCiphertext: boundedEncryptedBlobSchema(29),
  })
  .strict()
  .superRefine((migration, context) => {
    const expected = Buffer.from(migration.expectedCiphertext, "base64");
    const replacement = Buffer.from(migration.replacementCiphertext, "base64");
    try {
      if (expected[0] !== 1 || replacement[0] !== 2) {
        context.addIssue({ code: "custom", message: "Unsupported profile wrapper migration." });
      }
    } finally {
      expected.fill(0);
      replacement.fill(0);
    }
  });

const schema = z
  .object({
    wrappedUserRootKey: wrapperMigrationSchema.optional(),
    encryptedPersonalVaultKey: wrapperMigrationSchema.optional(),
  })
  .strict()
  .refine(
    (migration) => migration.wrappedUserRootKey !== undefined || migration.encryptedPersonalVaultKey !== undefined,
  );

type Dependencies = {
  authenticate: typeof authenticateApplicationMutation;
  cryptoProfiles: Pick<UserCryptoProfileRepository, "migrateUserCryptoProfile">;
};

export function createUserCryptoProfileMigrationHandler({ authenticate, cryptoProfiles }: Dependencies) {
  return async function POST(request: ApiRequest) {
    const user = await authenticate(request, "key_material_mutation", "fresh-provider-user");
    if (user instanceof ApiResponse) return user;
    const parsed = await safeParseJsonBody(request, schema);
    if (!parsed.success) return ApiResponse.json({ error: "invalid_profile_migration" }, { status: 400 });
    const migration = {
      ...(parsed.data.wrappedUserRootKey
        ? {
            wrappedUserRootKey: {
              expectedCiphertext: Buffer.from(parsed.data.wrappedUserRootKey.expectedCiphertext, "base64"),
              replacementCiphertext: Buffer.from(parsed.data.wrappedUserRootKey.replacementCiphertext, "base64"),
            },
          }
        : {}),
      ...(parsed.data.encryptedPersonalVaultKey
        ? {
            encryptedPersonalVaultKey: {
              expectedCiphertext: Buffer.from(parsed.data.encryptedPersonalVaultKey.expectedCiphertext, "base64"),
              replacementCiphertext: Buffer.from(parsed.data.encryptedPersonalVaultKey.replacementCiphertext, "base64"),
            },
          }
        : {}),
    };
    try {
      const result = await cryptoProfiles.migrateUserCryptoProfile(user.id, migration);
      if (result === "conflict") return ApiResponse.json({ error: "profile_migration_conflict" }, { status: 409 });
      return new ApiResponse(null, { status: 204 });
    } finally {
      migration.wrappedUserRootKey?.expectedCiphertext.fill(0);
      migration.wrappedUserRootKey?.replacementCiphertext.fill(0);
      migration.encryptedPersonalVaultKey?.expectedCiphertext.fill(0);
      migration.encryptedPersonalVaultKey?.replacementCiphertext.fill(0);
    }
  };
}

export async function POST(request: ApiRequest) {
  return createUserCryptoProfileMigrationHandler({
    authenticate: authenticateApplicationMutation,
    cryptoProfiles: getApiRequestContext(request).applicationRuntime.userCryptoProfiles(),
  })(request);
}
