import { verifyRegistrationResponse, type RegistrationResponseJSON } from "@simplewebauthn/server";
import { Buffer } from "node:buffer";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { loadApplicationUser } from "@/modules/identity/application/load-application-user";
import { PrismaApplicationUserRepository } from "@/modules/identity/infrastructure/prisma-application-user-repository";
import { PrismaPasskeyRecoveryRepository } from "@/modules/identity/infrastructure/prisma-passkey-recovery-repository";
import { passkeyRecoveryConfiguration } from "@/modules/identity/infrastructure/passkey-recovery-configuration";
import { SupabaseSessionVerifier } from "@/modules/identity/infrastructure/supabase-session-verifier";

const bodySchema = z.object({ response: z.unknown(), encryptedRecoveryPackage: z.base64().refine((value) => Buffer.byteLength(value, "base64") >= 13) });

export async function POST(request: NextRequest) {
  const user = await loadApplicationUser(new SupabaseSessionVerifier(), new PrismaApplicationUserRepository());
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!user.canAccessApplication()) return NextResponse.json({ error: "inactive_user" }, { status: 403 });
  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "invalid_passkey_recovery" }, { status: 400 });
  try {
    const repository = new PrismaPasskeyRecoveryRepository();
    const challenge = await repository.consumeChallenge(user.id, "REGISTRATION");
    if (!challenge) return NextResponse.json({ error: "passkey_challenge_expired" }, { status: 400 });
    const configuration = passkeyRecoveryConfiguration();
    const registrationResponse = parsed.data.response as RegistrationResponseJSON;
    const verification = await verifyRegistrationResponse({ response: registrationResponse, expectedChallenge: challenge, expectedOrigin: configuration.origin, expectedRPID: configuration.rpId, requireUserVerification: true });
    if (!verification.verified || !verification.registrationInfo) return NextResponse.json({ error: "passkey_verification_failed" }, { status: 400 });
    const { credential } = verification.registrationInfo;
    if (!prfEnabled(registrationResponse.clientExtensionResults)) return NextResponse.json({ error: "passkey_prf_required" }, { status: 400 });
    await repository.saveCredential(user.id, Buffer.from(credential.id, "base64url"), credential.publicKey, BigInt(credential.counter), credential.transports, Buffer.from(parsed.data.encryptedRecoveryPackage, "base64"));
    return new NextResponse(null, { status: 204 });
  } catch { return NextResponse.json({ error: "passkey_verification_failed" }, { status: 400 }); }
}

function prfEnabled(extensionResults: unknown): boolean {
  if (!extensionResults || typeof extensionResults !== "object") return false;
  const prf = (extensionResults as Record<string, unknown>).prf;
  return !!prf && typeof prf === "object" && (prf as Record<string, unknown>).enabled === true;
}
