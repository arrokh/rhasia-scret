import { getApiRequestContext } from "@api/http/api-context";
import { Buffer } from "@api/shared/infrastructure/base64";
import { ApiResponse, type ApiRequest } from "@api/http/api-request";
import { boundedEncryptedBlobSchema, safeParseJsonBody } from "@api/http/validation";
import { z } from "zod";
import { type UserCryptoProfileRepository } from "@api/modules/identity/server";
import { authenticateApplicationMutation } from "@api/shared/infrastructure/authenticated-application-request";

const schema = z
  .object({
    vaultUnlockSalt: z.base64().refine((value) => Buffer.byteLength(value, "base64") === 16),
    wrappedUserRootKey: boundedEncryptedBlobSchema(),
    encryptedPersonalVaultKey: boundedEncryptedBlobSchema().optional(),
    encryptionVersion: z.literal(1),
  })
  .strict();

type Dependencies = {
  authenticate: typeof authenticateApplicationMutation;
  cryptoProfiles: UserCryptoProfileRepository;
};

export function createRewrapUserRootKeyHandler({ authenticate, cryptoProfiles }: Dependencies) {
  return async function POST(request: ApiRequest) {
    const user = await authenticate(request, "key_material_mutation", "fresh-provider-user");
    if (user instanceof ApiResponse) return user;
    const parsed = await safeParseJsonBody(request, schema);
    if (!parsed.success) return ApiResponse.json({ error: "invalid_rewrap" }, { status: 400 });
    await cryptoProfiles.rewrapUserRootKey(user.id, {
      vaultUnlockSalt: Buffer.from(parsed.data.vaultUnlockSalt, "base64"),
      wrappedUserRootKey: Buffer.from(parsed.data.wrappedUserRootKey, "base64"),
      encryptedPersonalVaultKey: parsed.data.encryptedPersonalVaultKey
        ? Buffer.from(parsed.data.encryptedPersonalVaultKey, "base64")
        : undefined,
      encryptionVersion: parsed.data.encryptionVersion,
    });
    return new ApiResponse(null, { status: 204 });
  };
}

export async function POST(request: ApiRequest) {
  return createRewrapUserRootKeyHandler({
    authenticate: authenticateApplicationMutation,
    cryptoProfiles: getApiRequestContext(request).applicationRuntime.userCryptoProfiles(),
  })(request);
}
