import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { Buffer } from "node:buffer";
import { NextResponse } from "next/server";
import { loadApplicationUser } from "@/modules/identity/application/load-application-user";
import { createApplicationUserRepository } from "@/modules/identity/server";
import { PrismaPasskeyRecoveryRepository } from "@/modules/identity/infrastructure/prisma-passkey-recovery-repository";
import { passkeyRecoveryConfiguration } from "@/modules/identity/infrastructure/passkey-recovery-configuration";
import { createSessionVerifier } from "@/modules/identity/server";
import { rateLimitApplicationUser } from "@/modules/rate-limiting";

export async function POST() {
  const user = await loadApplicationUser(createSessionVerifier(), createApplicationUserRepository());
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!user.canAccessApplication()) return NextResponse.json({ error: "inactive_user" }, { status: 403 });
  const rateLimited = await rateLimitApplicationUser("recovery_authentication", user.id);
  if (rateLimited) return rateLimited;
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
