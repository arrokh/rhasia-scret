import { Buffer } from "node:buffer";
import { NextResponse } from "next/server";
import { loadApplicationUser } from "@/modules/identity/application/load-application-user";
import type { ApplicationUserRepository } from "@/modules/identity/application/application-user-repository";
import type { SessionVerifier } from "@/modules/identity/application/session-verifier";
import type { UserCryptoProfileRepository } from "@/modules/identity/application/user-crypto-profile-repository";
import { createApplicationUserRepository, createSessionVerifier } from "@/modules/identity/server";
import { PrismaUserCryptoProfileRepository } from "@/modules/identity/infrastructure/prisma-user-crypto-profile-repository";

type Dependencies = { sessionVerifier: SessionVerifier; applicationUsers: ApplicationUserRepository; cryptoProfiles: UserCryptoProfileRepository };

export function createGetUserCryptoProfileHandler({ sessionVerifier, applicationUsers, cryptoProfiles }: Dependencies) {
  return async function GET() {
    const user = await loadApplicationUser(sessionVerifier, applicationUsers);
    if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    if (!user.canAccessApplication()) return NextResponse.json({ error: "inactive_user" }, { status: 403 });
    const profile = await cryptoProfiles.get(user.id);
    if (!profile) return NextResponse.json({ error: "not_initialized" }, { status: 404 });
    return NextResponse.json({
      vaultUnlockSalt: Buffer.from(profile.vaultUnlockSalt).toString("base64"),
      wrappedUserRootKey: Buffer.from(profile.wrappedUserRootKey).toString("base64"),
      encryptedPersonalVaultKey: Buffer.from(profile.encryptedPersonalVaultKey).toString("base64"),
      encryptionVersion: profile.encryptionVersion,
      userEncryptionPublicKey: profile.userEncryptionPublicKey,
      encryptedUserPrivateKey: profile.encryptedUserPrivateKey ? Buffer.from(profile.encryptedUserPrivateKey).toString("base64") : undefined
    });
  };
}

export const GET = createGetUserCryptoProfileHandler({
  sessionVerifier: createSessionVerifier(),
  applicationUsers: createApplicationUserRepository(),
  cryptoProfiles: new PrismaUserCryptoProfileRepository()
});
