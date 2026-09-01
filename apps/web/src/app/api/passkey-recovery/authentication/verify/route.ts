import { verifyAuthenticationResponse, type AuthenticationResponseJSON } from "@simplewebauthn/server";
import { Buffer } from "node:buffer";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { browserE2eAuthenticationVerified, createPasskeyRecoveryRepository, passkeyRecoveryConfiguration } from "@/modules/identity/server";
import { authenticateApplicationMutation } from "@/shared/infrastructure/authenticated-application-request";

const bodySchema = z.object({ response: z.unknown() });

export async function POST(request: NextRequest) {
  const user = await authenticateApplicationMutation("recovery_authentication", "fresh-provider-user");
  if (user instanceof NextResponse) return user;
  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "invalid_passkey_recovery" }, { status: 400 });
  try {
    const repository = createPasskeyRecoveryRepository();
    const [challenge, credential] = await Promise.all([repository.consumeChallenge(user.id, "AUTHENTICATION"), repository.getCredential(user.id)]);
    if (!challenge || !credential) return NextResponse.json({ error: "passkey_challenge_expired" }, { status: 400 });
    if (browserE2eAuthenticationVerified(parsed.data.response, credential.credentialId)) {
      await repository.updateCounter(user.id, credential.counter + 1n);
      return NextResponse.json({ encryptedRecoveryPackage: Buffer.from(credential.encryptedRecoveryPackage).toString("base64") });
    }
    const configuration = passkeyRecoveryConfiguration();
    const verification = await verifyAuthenticationResponse({ response: parsed.data.response as AuthenticationResponseJSON, expectedChallenge: challenge, expectedOrigin: configuration.origin, expectedRPID: configuration.rpId, requireUserVerification: true, credential: { id: Buffer.from(credential.credentialId).toString("base64url"), publicKey: credential.publicKey, counter: Number(credential.counter), transports: undefined } });
    if (!verification.verified || !verification.authenticationInfo.userVerified) return NextResponse.json({ error: "passkey_verification_failed" }, { status: 400 });
    await repository.updateCounter(user.id, BigInt(verification.authenticationInfo.newCounter));
    return NextResponse.json({ encryptedRecoveryPackage: Buffer.from(credential.encryptedRecoveryPackage).toString("base64") });
  } catch { return NextResponse.json({ error: "passkey_verification_failed" }, { status: 400 }); }
}
