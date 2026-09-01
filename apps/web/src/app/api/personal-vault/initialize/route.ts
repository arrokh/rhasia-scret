import { Buffer } from "node:buffer";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createPersonalVaultRepository, initializePersonalVault, type PersonalVaultInitializer } from "@/modules/vault-management/server";
import { authenticateApplicationMutation } from "@/shared/infrastructure/authenticated-application-request";

const opaqueBlob = z.base64().refine((value) => Buffer.byteLength(value, "base64") >= 13);
const initializationSchema = z.object({
  vaultUnlockSalt: z.base64().refine((value) => Buffer.byteLength(value, "base64") === 16),
  wrappedUserRootKey: opaqueBlob,
  encryptedPersonalVaultKey: opaqueBlob,
  encryptedVaultName: opaqueBlob,
  encryptionVersion: z.literal(1)
});

type Dependencies = {
  authenticate: typeof authenticateApplicationMutation;
  personalVaults: PersonalVaultInitializer;
};

export function createInitializePersonalVaultHandler({ authenticate, personalVaults }: Dependencies) {
  return async function POST(request: NextRequest) {
    const user = await authenticate("key_material_mutation", "fresh-provider-user");
    if (user instanceof NextResponse) return user;
    const parsed = initializationSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "invalid_initialization" }, { status: 400 });
    await initializePersonalVault(user.id, {
      vaultUnlockSalt: Buffer.from(parsed.data.vaultUnlockSalt, "base64"),
      wrappedUserRootKey: Buffer.from(parsed.data.wrappedUserRootKey, "base64"),
      encryptedPersonalVaultKey: Buffer.from(parsed.data.encryptedPersonalVaultKey, "base64"),
      encryptedVaultName: Buffer.from(parsed.data.encryptedVaultName, "base64"),
      encryptionVersion: parsed.data.encryptionVersion
    }, personalVaults);
    return new NextResponse(null, { status: 204 });
  };
}

export const POST = createInitializePersonalVaultHandler({
  authenticate: authenticateApplicationMutation,
  personalVaults: createPersonalVaultRepository()
});
