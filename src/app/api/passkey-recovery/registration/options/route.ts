import { generateRegistrationOptions } from "@simplewebauthn/server";
import { Buffer } from "node:buffer";
import { NextResponse } from "next/server";
import { loadApplicationUser } from "@/modules/identity/application/load-application-user";
import { PrismaApplicationUserRepository } from "@/modules/identity/infrastructure/prisma-application-user-repository";
import { PrismaPasskeyRecoveryRepository } from "@/modules/identity/infrastructure/prisma-passkey-recovery-repository";
import { passkeyRecoveryConfiguration } from "@/modules/identity/infrastructure/passkey-recovery-configuration";
import { SupabaseSessionVerifier } from "@/modules/identity/infrastructure/supabase-session-verifier";
import { rateLimitApplicationUser } from "@/modules/rate-limiting";

export async function POST() {
  const user = await loadApplicationUser(new SupabaseSessionVerifier(), new PrismaApplicationUserRepository());
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!user.canAccessApplication()) return NextResponse.json({ error: "inactive_user" }, { status: 403 });
  const rateLimited = await rateLimitApplicationUser("recovery_mutation", user.id);
  if (rateLimited) return rateLimited;
  try {
    const repository = new PrismaPasskeyRecoveryRepository();
    const credential = await repository.getCredential(user.id);
    const configuration = passkeyRecoveryConfiguration();
    // TypeScript's WebAuthn DOM declarations lag the standardized PRF extension.
    const prfExtensions = { prf: {} } as unknown as AuthenticationExtensionsClientInputs;
    const options = await generateRegistrationOptions({ rpName: configuration.rpName, rpID: configuration.rpId, userName: user.email, userID: new TextEncoder().encode(user.id), authenticatorSelection: { residentKey: "required", userVerification: "required" }, extensions: prfExtensions, excludeCredentials: credential ? [{ id: Buffer.from(credential.credentialId).toString("base64url") }] : undefined });
    await repository.issueChallenge(user.id, "REGISTRATION", options.challenge);
    return NextResponse.json(options);
  } catch { return NextResponse.json({ error: "passkey_recovery_unavailable" }, { status: 503 }); }
}
