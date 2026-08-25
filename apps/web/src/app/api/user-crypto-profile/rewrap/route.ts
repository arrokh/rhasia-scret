import { Buffer } from "node:buffer";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createApplicationUserRepository, createSessionVerifier, createUserCryptoProfileRepository, loadApplicationUser, type ApplicationUserRepository, type SessionVerifier, type UserCryptoProfileRepository } from "@/modules/identity/server";
import { rateLimitApplicationUser } from "@/modules/rate-limiting";

const schema = z.object({
  vaultUnlockSalt: z.base64().refine((value) => Buffer.byteLength(value, "base64") === 16),
  wrappedUserRootKey: z.base64().refine((value) => Buffer.byteLength(value, "base64") >= 13),
  encryptedPersonalVaultKey: z.base64().refine((value) => Buffer.byteLength(value, "base64") >= 13).optional(),
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
      encryptedPersonalVaultKey: parsed.data.encryptedPersonalVaultKey ? Buffer.from(parsed.data.encryptedPersonalVaultKey, "base64") : undefined,
      encryptionVersion: parsed.data.encryptionVersion
    });
    return new NextResponse(null, { status: 204 });
  };
}

export const POST = createRewrapUserRootKeyHandler({
  sessionVerifier: createSessionVerifier(),
  applicationUsers: createApplicationUserRepository(),
  cryptoProfiles: createUserCryptoProfileRepository()
});
