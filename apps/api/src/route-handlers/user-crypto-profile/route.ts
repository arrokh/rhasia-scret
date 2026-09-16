import { getApiRequestContext } from "@api/http/api-context";
import { Buffer } from "@api/shared/infrastructure/base64";
import { ApiResponse, type ApiRequest } from "@api/http/api-request";
import { createUserCryptoProfileRepository, type UserCryptoProfileRepository } from "@api/modules/identity/server";
import { authenticateApplicationReader } from "@api/shared/infrastructure/authenticated-application-request";

type Dependencies = { authenticate: typeof authenticateApplicationReader; cryptoProfiles: UserCryptoProfileRepository };

export function createGetUserCryptoProfileHandler({ authenticate, cryptoProfiles }: Dependencies) {
  return async function GET(request: ApiRequest) {
    const user = await authenticate(request, "fresh-provider-user");
    if (user instanceof ApiResponse) return user;
    const profile = await cryptoProfiles.get(user.id);
    if (!profile) return ApiResponse.json({ error: "not_initialized" }, { status: 404 });
    return ApiResponse.json({
      vaultUnlockSalt: Buffer.from(profile.vaultUnlockSalt).toString("base64"),
      wrappedUserRootKey: Buffer.from(profile.wrappedUserRootKey).toString("base64"),
      encryptedPersonalVaultKey: Buffer.from(profile.encryptedPersonalVaultKey).toString("base64"),
      encryptionVersion: profile.encryptionVersion,
      userEncryptionPublicKey: profile.userEncryptionPublicKey,
      encryptedUserPrivateKey: profile.encryptedUserPrivateKey
        ? Buffer.from(profile.encryptedUserPrivateKey).toString("base64")
        : undefined,
    });
  };
}

export async function GET(request: ApiRequest) {
  return createGetUserCryptoProfileHandler({
    authenticate: authenticateApplicationReader,
    cryptoProfiles: createUserCryptoProfileRepository(getApiRequestContext(request).database),
  })(request);
}
