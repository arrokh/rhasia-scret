import { getApiRequestContext } from "@api/http/api-context";
import { Buffer } from "@api/shared/infrastructure/base64";
import { ApiResponse, type ApiRequest } from "@api/http/api-request";
import { boundedEncryptedBlobSchema, safeParseJsonBody } from "@api/http/validation";
import { publicEncryptionKeySchema } from "@api/http/public-encryption-key";
import { z } from "zod";
import { initializePersonalVault, type PersonalVaultInitializer } from "@api/modules/vault-management/server";
import { authenticateApplicationMutation } from "@api/shared/infrastructure/authenticated-application-request";

const opaqueBlob = boundedEncryptedBlobSchema();
const initializationSchema = z
  .object({
    vaultUnlockSalt: z.base64().refine((value) => Buffer.byteLength(value, "base64") === 16),
    wrappedUserRootKey: opaqueBlob,
    encryptedPersonalVaultKey: opaqueBlob,
    encryptedVaultName: opaqueBlob,
    userEncryptionPublicKey: publicEncryptionKeySchema,
    encryptedUserPrivateKey: opaqueBlob,
    userEncryptionKeyVersion: z.literal(1),
    encryptionVersion: z.literal(1),
  })
  .strict();

type Dependencies = {
  authenticate: typeof authenticateApplicationMutation;
  personalVaults: PersonalVaultInitializer;
};

export function createInitializePersonalVaultHandler({ authenticate, personalVaults }: Dependencies) {
  return async function POST(request: ApiRequest) {
    const user = await authenticate(request, "key_material_mutation", "fresh-provider-user");
    if (user instanceof ApiResponse) return user;
    const parsed = await safeParseJsonBody(request, initializationSchema);
    if (!parsed.success) return ApiResponse.json({ error: "invalid_initialization" }, { status: 400 });
    await initializePersonalVault(
      user.id,
      {
        vaultUnlockSalt: Buffer.from(parsed.data.vaultUnlockSalt, "base64"),
        wrappedUserRootKey: Buffer.from(parsed.data.wrappedUserRootKey, "base64"),
        encryptedPersonalVaultKey: Buffer.from(parsed.data.encryptedPersonalVaultKey, "base64"),
        encryptedVaultName: Buffer.from(parsed.data.encryptedVaultName, "base64"),
        userEncryptionPublicKey: parsed.data.userEncryptionPublicKey as JsonWebKey,
        encryptedUserPrivateKey: Buffer.from(parsed.data.encryptedUserPrivateKey, "base64"),
        userEncryptionKeyVersion: parsed.data.userEncryptionKeyVersion,
        encryptionVersion: parsed.data.encryptionVersion,
      },
      personalVaults,
    );
    return new ApiResponse(null, { status: 204 });
  };
}

export async function POST(request: ApiRequest) {
  return createInitializePersonalVaultHandler({
    authenticate: authenticateApplicationMutation,
    personalVaults: getApiRequestContext(request).applicationRuntime.personalVaults(),
  })(request);
}
