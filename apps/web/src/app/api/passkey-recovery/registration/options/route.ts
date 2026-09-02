import { generateRegistrationOptions } from "@simplewebauthn/server";
import { Buffer } from "node:buffer";
import { NextResponse } from "next/server";
import { createPasskeyRecoveryRepository, passkeyRecoveryConfiguration } from "@/modules/identity/server";
import { authenticateApplicationMutation } from "@/shared/infrastructure/authenticated-application-request";

export async function POST() {
  const user = await authenticateApplicationMutation("recovery_mutation", "fresh-provider-user");
  if (user instanceof NextResponse) return user;
  try {
    const repository = createPasskeyRecoveryRepository();
    const credential = await repository.getCredential(user.id);
    const configuration = passkeyRecoveryConfiguration();
    // TypeScript's WebAuthn DOM declarations lag the standardized PRF extension.
    const prfExtensions = { prf: {} } as unknown as AuthenticationExtensionsClientInputs;
    const options = await generateRegistrationOptions({ rpName: configuration.rpName, rpID: configuration.rpId, userName: user.email, userID: new TextEncoder().encode(user.id), authenticatorSelection: { residentKey: "required", userVerification: "required" }, extensions: prfExtensions, excludeCredentials: credential ? [{ id: Buffer.from(credential.credentialId).toString("base64url") }] : undefined });
    await repository.issueChallenge(user.id, "REGISTRATION", options.challenge);
    return NextResponse.json(options);
  } catch { return NextResponse.json({ error: "passkey_recovery_unavailable" }, { status: 503 }); }
}
