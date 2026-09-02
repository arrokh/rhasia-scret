import { Buffer } from "node:buffer";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createUserCryptoProfileRepository, type UserCryptoProfileRepository } from "@/modules/identity/server";
import { authenticateApplicationMutation } from "@/shared/infrastructure/authenticated-application-request";

const schema = z.object({
  vaultUnlockSalt: z.base64().refine((value) => Buffer.byteLength(value, "base64") === 16),
  wrappedUserRootKey: z.base64().refine((value) => Buffer.byteLength(value, "base64") >= 13),
  encryptedPersonalVaultKey: z.base64().refine((value) => Buffer.byteLength(value, "base64") >= 13).optional(),
  encryptionVersion: z.literal(1)
});

type Dependencies = {
  authenticate: typeof authenticateApplicationMutation;
  cryptoProfiles: UserCryptoProfileRepository;
};

export function createRewrapUserRootKeyHandler({ authenticate, cryptoProfiles }: Dependencies) {
  return async function POST(request: NextRequest) {
    const user = await authenticate("key_material_mutation", "fresh-provider-user");
    if (user instanceof NextResponse) return user;
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
  authenticate: authenticateApplicationMutation,
  cryptoProfiles: createUserCryptoProfileRepository()
});
