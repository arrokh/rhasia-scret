import { getApiRequestContext } from "@api/http/api-context";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { Buffer } from "@api/shared/infrastructure/base64";
import { ApiResponse, type ApiRequest } from "@api/http/api-request";
import { passkeyRecoveryConfiguration } from "@api/modules/identity/server";
import { authenticateApplicationMutation } from "@api/shared/infrastructure/authenticated-application-request";

export async function POST(request: ApiRequest) {
  const user = await authenticateApplicationMutation(request, "recovery_authentication", "fresh-provider-user");
  if (user instanceof ApiResponse) return user;
  try {
    const repository = getApiRequestContext(request).applicationRuntime.passkeyRecovery();
    const credential = await repository.getCredential(user.id);
    if (!credential) return ApiResponse.json({ error: "passkey_recovery_unavailable" }, { status: 404 });
    const configuration = passkeyRecoveryConfiguration(getApiRequestContext(request).bindings);
    const options = await generateAuthenticationOptions({
      rpID: configuration.rpId,
      userVerification: "required",
      allowCredentials: [{ id: Buffer.from(credential.credentialId).toString("base64url") }],
    });
    await repository.issueChallenge(user.id, "AUTHENTICATION", options.challenge);
    return ApiResponse.json(
      { ...options, encryptedRecoveryPackage: Buffer.from(credential.encryptedRecoveryPackage).toString("base64") },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return ApiResponse.json({ error: "passkey_recovery_unavailable" }, { status: 503 });
  }
}
