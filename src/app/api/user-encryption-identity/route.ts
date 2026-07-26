import { Buffer } from "node:buffer";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { loadApplicationUser } from "@/modules/identity/application/load-application-user";
import type { ApplicationUserRepository } from "@/modules/identity/application/application-user-repository";
import type { SessionVerifier } from "@/modules/identity/application/session-verifier";
import type { UserCryptoProfileRepository } from "@/modules/identity/application/user-crypto-profile-repository";
import { PrismaApplicationUserRepository } from "@/modules/identity/infrastructure/prisma-application-user-repository";
import { PrismaUserCryptoProfileRepository } from "@/modules/identity/infrastructure/prisma-user-crypto-profile-repository";
import { SupabaseSessionVerifier } from "@/modules/identity/infrastructure/supabase-session-verifier";
import { rateLimitApplicationUser } from "@/modules/rate-limiting";

const publicKeySchema = z.object({ kty: z.literal("EC"), crv: z.literal("P-256"), x: z.string(), y: z.string() }).passthrough().refine((key) => !("d" in key));
const schema = z.object({ publicKey: publicKeySchema, encryptedPrivateKey: z.base64().refine((value) => Buffer.byteLength(value, "base64") >= 13), encryptionVersion: z.literal(1) });
type Dependencies = { sessionVerifier: SessionVerifier; applicationUsers: ApplicationUserRepository; cryptoProfiles: UserCryptoProfileRepository };

export function createUserEncryptionIdentityHandler({ sessionVerifier, applicationUsers, cryptoProfiles }: Dependencies) {
  return async function PUT(request: NextRequest) {
    const user = await loadApplicationUser(sessionVerifier, applicationUsers);
    if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    if (!user.canAccessApplication()) return NextResponse.json({ error: "inactive_user" }, { status: 403 });
    const rateLimited = await rateLimitApplicationUser("key_material_mutation", user.id);
    if (rateLimited) return rateLimited;
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "invalid_identity" }, { status: 400 });
    await cryptoProfiles.registerUserEncryptionIdentity(user.id, {
      publicKey: parsed.data.publicKey as JsonWebKey,
      encryptedPrivateKey: Buffer.from(parsed.data.encryptedPrivateKey, "base64"),
      encryptionVersion: parsed.data.encryptionVersion
    });
    return new NextResponse(null, { status: 204 });
  };
}

export const PUT = createUserEncryptionIdentityHandler({
  sessionVerifier: new SupabaseSessionVerifier(),
  applicationUsers: new PrismaApplicationUserRepository(),
  cryptoProfiles: new PrismaUserCryptoProfileRepository()
});
