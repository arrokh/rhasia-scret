import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { Buffer } from "node:buffer";
import { NextResponse } from "next/server";
import { createPasskeyRecoveryRepository, passkeyRecoveryConfiguration } from "@/modules/identity/server";
import { authenticateApplicationMutation } from "@/shared/infrastructure/authenticated-application-request";

export async function POST() {
  const user = await authenticateApplicationMutation("recovery_authentication", "fresh-provider-user");
  if (user instanceof NextResponse) return user;
  try {
    const repository = createPasskeyRecoveryRepository();
    const credential = await repository.getCredential(user.id);
    if (!credential) return NextResponse.json({ error: "passkey_recovery_unavailable" }, { status: 404 });
    const configuration = passkeyRecoveryConfiguration();
    const options = await generateAuthenticationOptions({
      rpID: configuration.rpId,
      userVerification: "required",
      allowCredentials: [{ id: Buffer.from(credential.credentialId).toString("base64url") }],
    });
    await repository.issueChallenge(user.id, "AUTHENTICATION", options.challenge);
    return NextResponse.json(
      { ...options, encryptedRecoveryPackage: Buffer.from(credential.encryptedRecoveryPackage).toString("base64") },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "passkey_recovery_unavailable" }, { status: 503 });
  }
}
