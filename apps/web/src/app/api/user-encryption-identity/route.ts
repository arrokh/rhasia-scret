import { Buffer } from "node:buffer";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createUserCryptoProfileRepository, type UserCryptoProfileRepository } from "@/modules/identity/server";
import { authenticateApplicationMutation } from "@/shared/infrastructure/authenticated-application-request";

const publicKeySchema = z
  .object({ kty: z.literal("EC"), crv: z.literal("P-256"), x: z.string(), y: z.string() })
  .passthrough()
  .refine((key) => !("d" in key));
const schema = z.object({
  publicKey: publicKeySchema,
  encryptedPrivateKey: z.base64().refine((value) => Buffer.byteLength(value, "base64") >= 13),
  encryptionVersion: z.literal(1),
});
type Dependencies = {
  authenticate: typeof authenticateApplicationMutation;
  cryptoProfiles: UserCryptoProfileRepository;
};

export function createUserEncryptionIdentityHandler({ authenticate, cryptoProfiles }: Dependencies) {
  return async function PUT(request: NextRequest) {
    const user = await authenticate("key_material_mutation", "fresh-provider-user");
    if (user instanceof NextResponse) return user;
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "invalid_identity" }, { status: 400 });
    await cryptoProfiles.registerUserEncryptionIdentity(user.id, {
      publicKey: parsed.data.publicKey as JsonWebKey,
      encryptedPrivateKey: Buffer.from(parsed.data.encryptedPrivateKey, "base64"),
      encryptionVersion: parsed.data.encryptionVersion,
    });
    return new NextResponse(null, { status: 204 });
  };
}

export const PUT = createUserEncryptionIdentityHandler({
  authenticate: authenticateApplicationMutation,
  cryptoProfiles: createUserCryptoProfileRepository(),
});
