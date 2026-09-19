import { getApiRequestContext } from "@api/http/api-context";
import { verifyAuthenticationResponse, type AuthenticationResponseJSON } from "@simplewebauthn/server";
import { Buffer } from "@api/shared/infrastructure/base64";
import { ApiResponse, type ApiRequest } from "@api/http/api-request";
import { z } from "zod";
import {
  browserE2eAuthenticationVerified,
  createPasskeyRecoveryRepository,
  passkeyRecoveryConfiguration,
} from "@api/modules/identity/server";
import { authenticateApplicationMutation } from "@api/shared/infrastructure/authenticated-application-request";

const bodySchema = z.object({ response: z.unknown() });

export async function POST(request: ApiRequest) {
  const user = await authenticateApplicationMutation(request, "recovery_authentication", "fresh-provider-user");
  if (user instanceof ApiResponse) return user;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return ApiResponse.json({ error: "invalid_passkey_recovery" }, { status: 400 });
  try {
    const repository = createPasskeyRecoveryRepository(getApiRequestContext(request).database);
    const [challenge, credential] = await Promise.all([
      repository.consumeChallenge(user.id, "AUTHENTICATION"),
      repository.getCredential(user.id),
    ]);
    if (!challenge || !credential) return ApiResponse.json({ error: "passkey_challenge_expired" }, { status: 400 });
    const bindings = getApiRequestContext(request).bindings;
    const authenticationResponse = parsed.data.response as AuthenticationResponseJSON;
    if (browserE2eAuthenticationVerified(authenticationResponse, credential.credentialId, bindings)) {
      await repository.updateCounter(user.id, credential.counter + 1n);
      return ApiResponse.json({
        encryptedRecoveryPackage: Buffer.from(credential.encryptedRecoveryPackage).toString("base64"),
      });
    }
    const configuration = passkeyRecoveryConfiguration(bindings);
    const verification = await verifyAuthenticationResponse({
      response: authenticationResponse,
      expectedChallenge: challenge,
      expectedOrigin: configuration.origin,
      expectedRPID: configuration.rpId,
      requireUserVerification: true,
      credential: {
        id: Buffer.from(credential.credentialId).toString("base64url"),
        publicKey: credential.publicKey,
        counter: Number(credential.counter),
        transports: undefined,
      },
    });
    if (!verification.verified || !verification.authenticationInfo.userVerified)
      return ApiResponse.json({ error: "passkey_verification_failed" }, { status: 400 });
    await repository.updateCounter(user.id, BigInt(verification.authenticationInfo.newCounter));
    return ApiResponse.json({
      encryptedRecoveryPackage: Buffer.from(credential.encryptedRecoveryPackage).toString("base64"),
    });
  } catch {
    return ApiResponse.json({ error: "passkey_verification_failed" }, { status: 400 });
  }
}
