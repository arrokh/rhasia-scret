import { Buffer } from "node:buffer";
import { NextResponse } from "next/server";
import { createUserCryptoProfileRepository, type UserCryptoProfileRepository } from "@/modules/identity/server";
import { authenticateApplicationReader } from "@/shared/infrastructure/authenticated-application-request";

type Dependencies = { authenticate: typeof authenticateApplicationReader; cryptoProfiles: UserCryptoProfileRepository };

export function createGetUserCryptoProfileHandler({ authenticate, cryptoProfiles }: Dependencies) {
  return async function GET() {
    const user = await authenticate("fresh-provider-user");
    if (user instanceof NextResponse) return user;
    const profile = await cryptoProfiles.get(user.id);
    if (!profile) return NextResponse.json({ error: "not_initialized" }, { status: 404 });
    return NextResponse.json({
      vaultUnlockSalt: Buffer.from(profile.vaultUnlockSalt).toString("base64"),
      wrappedUserRootKey: Buffer.from(profile.wrappedUserRootKey).toString("base64"),
      encryptedPersonalVaultKey: Buffer.from(profile.encryptedPersonalVaultKey).toString("base64"),
      encryptionVersion: profile.encryptionVersion,
      userEncryptionPublicKey: profile.userEncryptionPublicKey,
      encryptedUserPrivateKey: profile.encryptedUserPrivateKey
        ? Buffer.from(profile.encryptedUserPrivateKey).toString("base64")
        : undefined,
    });
  };
}

export const GET = createGetUserCryptoProfileHandler({
  authenticate: authenticateApplicationReader,
  cryptoProfiles: createUserCryptoProfileRepository(),
});
