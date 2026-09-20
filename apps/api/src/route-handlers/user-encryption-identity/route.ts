import { getApiRequestContext } from "@api/http/api-context";
import { Buffer } from "@api/shared/infrastructure/base64";
import { ApiResponse, type ApiRequest } from "@api/http/api-request";
import { boundedEncryptedBlobSchema, safeParseJsonBody } from "@api/http/validation";
import { z } from "zod";
import { type UserCryptoProfileRepository } from "@api/modules/identity/server";
import { authenticateApplicationMutation } from "@api/shared/infrastructure/authenticated-application-request";

const publicKeySchema = z
  .object({
    kty: z.literal("EC"),
    crv: z.literal("P-256"),
    x: z.string().min(1).max(128),
    y: z.string().min(1).max(128),
  })
  .passthrough()
  .refine((key) => !("d" in key));
const schema = z
  .object({
    publicKey: publicKeySchema,
    encryptedPrivateKey: boundedEncryptedBlobSchema(),
    encryptionVersion: z.literal(1),
  })
  .strict();
type Dependencies = {
  authenticate: typeof authenticateApplicationMutation;
  cryptoProfiles: UserCryptoProfileRepository;
};

export function createUserEncryptionIdentityHandler({ authenticate, cryptoProfiles }: Dependencies) {
  return async function PUT(request: ApiRequest) {
    const user = await authenticate(request, "key_material_mutation", "fresh-provider-user");
    if (user instanceof ApiResponse) return user;
    const parsed = await safeParseJsonBody(request, schema);
    if (!parsed.success) return ApiResponse.json({ error: "invalid_identity" }, { status: 400 });
    await cryptoProfiles.registerUserEncryptionIdentity(user.id, {
      publicKey: parsed.data.publicKey as JsonWebKey,
      encryptedPrivateKey: Buffer.from(parsed.data.encryptedPrivateKey, "base64"),
      encryptionVersion: parsed.data.encryptionVersion,
    });
    return new ApiResponse(null, { status: 204 });
  };
}

export async function PUT(request: ApiRequest) {
  return createUserEncryptionIdentityHandler({
    authenticate: authenticateApplicationMutation,
    cryptoProfiles: getApiRequestContext(request).applicationRuntime.userCryptoProfiles(),
  })(request);
}
