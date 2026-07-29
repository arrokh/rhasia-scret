import { verifyAuthenticationResponse, type AuthenticationResponseJSON } from "@simplewebauthn/server";
import { Buffer } from "node:buffer";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { loadApplicationUser } from "@/modules/identity/application/load-application-user";
import { createApplicationUserRepository, createSessionVerifier } from "@/modules/identity/server";
import { PrismaPasskeyRecoveryRepository } from "@/modules/identity/infrastructure/prisma-passkey-recovery-repository";
import { browserE2eAuthenticationVerified } from "@/modules/identity/infrastructure/browser-e2e-passkey-verification";
import { passkeyRecoveryConfiguration } from "@/modules/identity/infrastructure/passkey-recovery-configuration";
import { rateLimitApplicationUser } from "@/modules/rate-limiting";

const bodySchema = z.object({ response: z.unknown() });

export async function POST(request: NextRequest) {
  const user = await loadApplicationUser(createSessionVerifier(), createApplicationUserRepository());
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!user.canAccessApplication()) return NextResponse.json({ error: "inactive_user" }, { status: 403 });
  const rateLimited = await rateLimitApplicationUser("recovery_authentication", user.id);
  if (rateLimited) return rateLimited;
  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "invalid_passkey_recovery" }, { status: 400 });
  try {
    const repository = new PrismaPasskeyRecoveryRepository();
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
