import { Buffer } from "node:buffer";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createApplicationUserRepository, createSessionVerifier, loadApplicationUser, type ApplicationUserRepository, type SessionVerifier } from "@/modules/identity/server";
import { rateLimitApplicationUser } from "@/modules/rate-limiting";
import { createPersonalVaultRepository, initializePersonalVault, type PersonalVaultInitializer } from "@/modules/vault-management/server";

const opaqueBlob = z.base64().refine((value) => Buffer.byteLength(value, "base64") >= 13);
const initializationSchema = z.object({
  vaultUnlockSalt: z.base64().refine((value) => Buffer.byteLength(value, "base64") === 16),
  wrappedUserRootKey: opaqueBlob,
  encryptedPersonalVaultKey: opaqueBlob,
  encryptedVaultName: opaqueBlob,
  encryptionVersion: z.literal(1)
});

type Dependencies = {
  sessionVerifier: SessionVerifier;
  applicationUsers: ApplicationUserRepository;
  personalVaults: PersonalVaultInitializer;
};

export function createInitializePersonalVaultHandler({ sessionVerifier, applicationUsers, personalVaults }: Dependencies) {
  return async function POST(request: NextRequest) {
    const user = await loadApplicationUser(sessionVerifier, applicationUsers);
    if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    if (!user.canAccessApplication()) return NextResponse.json({ error: "inactive_user" }, { status: 403 });
    const rateLimited = await rateLimitApplicationUser("key_material_mutation", user.id);
    if (rateLimited) return rateLimited;
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
  sessionVerifier: createSessionVerifier(),
  applicationUsers: createApplicationUserRepository(),
  personalVaults: createPersonalVaultRepository()
});
