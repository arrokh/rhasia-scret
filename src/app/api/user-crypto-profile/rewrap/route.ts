import { Buffer } from "node:buffer";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { loadApplicationUser } from "@/modules/identity/application/load-application-user";
import type { ApplicationUserRepository } from "@/modules/identity/application/application-user-repository";
import type { SessionVerifier } from "@/modules/identity/application/session-verifier";
import { createApplicationUserRepository, createSessionVerifier } from "@/modules/identity/server";
import type { UserCryptoProfileRepository } from "@/modules/identity/application/user-crypto-profile-repository";
import { PrismaUserCryptoProfileRepository } from "@/modules/identity/infrastructure/prisma-user-crypto-profile-repository";
import { rateLimitApplicationUser } from "@/modules/rate-limiting";

const schema = z.object({
  vaultUnlockSalt: z.base64().refine((value) => Buffer.byteLength(value, "base64") === 16),
  wrappedUserRootKey: z.base64().refine((value) => Buffer.byteLength(value, "base64") >= 13),
  encryptionVersion: z.literal(1)
});

type Dependencies = {
  sessionVerifier: SessionVerifier;
  applicationUsers: ApplicationUserRepository;
  cryptoProfiles: UserCryptoProfileRepository;
};

export function createRewrapUserRootKeyHandler({ sessionVerifier, applicationUsers, cryptoProfiles }: Dependencies) {
  return async function POST(request: NextRequest) {
    const user = await loadApplicationUser(sessionVerifier, applicationUsers);
    if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    if (!user.canAccessApplication()) return NextResponse.json({ error: "inactive_user" }, { status: 403 });
    const rateLimited = await rateLimitApplicationUser("key_material_mutation", user.id);
    if (rateLimited) return rateLimited;
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "invalid_rewrap" }, { status: 400 });
    await cryptoProfiles.rewrapUserRootKey(user.id, {
      vaultUnlockSalt: Buffer.from(parsed.data.vaultUnlockSalt, "base64"),
      wrappedUserRootKey: Buffer.from(parsed.data.wrappedUserRootKey, "base64"),
      encryptionVersion: parsed.data.encryptionVersion
    });
    return new NextResponse(null, { status: 204 });
  };
}

export const POST = createRewrapUserRootKeyHandler({
  sessionVerifier: createSessionVerifier(),
  applicationUsers: createApplicationUserRepository(),
  cryptoProfiles: new PrismaUserCryptoProfileRepository()
});
