import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { Buffer } from "node:buffer";
import { NextResponse } from "next/server";
import { loadApplicationUser } from "@/modules/identity/application/load-application-user";
import { PrismaApplicationUserRepository } from "@/modules/identity/infrastructure/prisma-application-user-repository";
import { PrismaPasskeyRecoveryRepository } from "@/modules/identity/infrastructure/prisma-passkey-recovery-repository";
import { passkeyRecoveryConfiguration } from "@/modules/identity/infrastructure/passkey-recovery-configuration";
import { SupabaseSessionVerifier } from "@/modules/identity/infrastructure/supabase-session-verifier";

export async function POST() {
  const user = await loadApplicationUser(new SupabaseSessionVerifier(), new PrismaApplicationUserRepository());
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!user.canAccessApplication()) return NextResponse.json({ error: "inactive_user" }, { status: 403 });
  try {
    const repository = new PrismaPasskeyRecoveryRepository();
    const credential = await repository.getCredential(user.id);
    if (!credential) return NextResponse.json({ error: "passkey_recovery_unavailable" }, { status: 404 });
    const configuration = passkeyRecoveryConfiguration();
    const options = await generateAuthenticationOptions({ rpID: configuration.rpId, userVerification: "required", allowCredentials: [{ id: Buffer.from(credential.credentialId).toString("base64url") }] });
    await repository.issueChallenge(user.id, "AUTHENTICATION", options.challenge);
    return NextResponse.json(options);
  } catch { return NextResponse.json({ error: "passkey_recovery_unavailable" }, { status: 503 }); }
}
