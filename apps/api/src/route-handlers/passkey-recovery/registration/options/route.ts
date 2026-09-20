import { getApiRequestContext } from "@api/http/api-context";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import { Buffer } from "@api/shared/infrastructure/base64";
import { ApiResponse, type ApiRequest } from "@api/http/api-request";
import { passkeyRecoveryConfiguration } from "@api/modules/identity/server";
import { authenticateApplicationMutation } from "@api/shared/infrastructure/authenticated-application-request";

export async function POST(request: ApiRequest) {
  const user = await authenticateApplicationMutation(request, "recovery_mutation", "fresh-provider-user");
  if (user instanceof ApiResponse) return user;
  try {
    const repository = getApiRequestContext(request).applicationRuntime.passkeyRecovery();
    const credential = await repository.getCredential(user.id);
    const configuration = passkeyRecoveryConfiguration(getApiRequestContext(request).bindings);
    // TypeScript's WebAuthn DOM declarations lag the standardized PRF extension.
    const prfExtensions = { prf: {} } as unknown as AuthenticationExtensionsClientInputs;
    const options = await generateRegistrationOptions({
      rpName: configuration.rpName,
      rpID: configuration.rpId,
      userName: user.email,
      userID: new TextEncoder().encode(user.id),
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
      extensions: prfExtensions,
      excludeCredentials: credential ? [{ id: Buffer.from(credential.credentialId).toString("base64url") }] : undefined,
    });
    await repository.issueChallenge(user.id, "REGISTRATION", options.challenge);
    return ApiResponse.json(options);
  } catch {
    return ApiResponse.json({ error: "passkey_recovery_unavailable" }, { status: 503 });
  }
}
