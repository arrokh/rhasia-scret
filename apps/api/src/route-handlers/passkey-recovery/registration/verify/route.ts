import { getApiRequestContext } from "@api/http/api-context";
import { verifyRegistrationResponse, type RegistrationResponseJSON } from "@simplewebauthn/server";
import { Buffer } from "@api/shared/infrastructure/base64";
import { ApiResponse, type ApiRequest } from "@api/http/api-request";
import { z } from "zod";
import {
  browserE2eRegistrationCredential,
  createPasskeyRecoveryRepository,
  passkeyRecoveryConfiguration,
} from "@api/modules/identity/server";
import { authenticateApplicationMutation } from "@api/shared/infrastructure/authenticated-application-request";

const bodySchema = z.object({
  response: z.unknown(),
  encryptedRecoveryPackage: z.base64().refine((value) => Buffer.byteLength(value, "base64") >= 13),
});

export async function POST(request: ApiRequest) {
  const user = await authenticateApplicationMutation(request, "recovery_mutation", "fresh-provider-user");
  if (user instanceof ApiResponse) return user;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return ApiResponse.json({ error: "invalid_passkey_recovery" }, { status: 400 });
  try {
    const repository = createPasskeyRecoveryRepository(getApiRequestContext(request).database);
    const challenge = await repository.consumeChallenge(user.id, "REGISTRATION");
    if (!challenge) return ApiResponse.json({ error: "passkey_challenge_expired" }, { status: 400 });
    const registrationResponse = parsed.data.response as RegistrationResponseJSON;
    const bindings = getApiRequestContext(request).bindings;
    const testCredential = browserE2eRegistrationCredential(registrationResponse, bindings);
    if (testCredential) {
      await repository.saveCredential(
        user.id,
        testCredential.credentialId,
        testCredential.publicKey,
        0n,
        testCredential.transports,
        Buffer.from(parsed.data.encryptedRecoveryPackage, "base64"),
      );
      return new ApiResponse(null, { status: 204 });
    }
    const configuration = passkeyRecoveryConfiguration(bindings);
    const verification = await verifyRegistrationResponse({
      response: registrationResponse,
      expectedChallenge: challenge,
      expectedOrigin: configuration.origin,
      expectedRPID: configuration.rpId,
      requireUserVerification: true,
    });
    if (!verification.verified || !verification.registrationInfo)
      return ApiResponse.json({ error: "passkey_verification_failed" }, { status: 400 });
    const { credential } = verification.registrationInfo;
    if (!prfEnabled(registrationResponse.clientExtensionResults))
      return ApiResponse.json({ error: "passkey_prf_required" }, { status: 400 });
    await repository.saveCredential(
      user.id,
      Buffer.from(credential.id, "base64url"),
      credential.publicKey,
      BigInt(credential.counter),
      credential.transports,
      Buffer.from(parsed.data.encryptedRecoveryPackage, "base64"),
    );
    return new ApiResponse(null, { status: 204 });
  } catch {
    return ApiResponse.json({ error: "passkey_verification_failed" }, { status: 400 });
  }
}

function prfEnabled(extensionResults: unknown): boolean {
  if (!extensionResults || typeof extensionResults !== "object") return false;
  const prf = (extensionResults as Record<string, unknown>).prf;
  return !!prf && typeof prf === "object" && (prf as Record<string, unknown>).enabled === true;
}
