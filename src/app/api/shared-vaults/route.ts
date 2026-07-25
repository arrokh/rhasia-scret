import { Buffer } from "node:buffer";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { loadApplicationUser } from "@/modules/identity/application/load-application-user";
import type { ApplicationUserRepository } from "@/modules/identity/application/application-user-repository";
import type { SessionVerifier } from "@/modules/identity/application/session-verifier";
import { PrismaApplicationUserRepository } from "@/modules/identity/infrastructure/prisma-application-user-repository";
import type { SharedVaultRepository } from "@/modules/vault-management/application/shared-vault-repository";
import { PrismaSharedVaultRepository } from "@/modules/vault-management/infrastructure/prisma-shared-vault-repository";
import { SupabaseSessionVerifier } from "@/modules/identity/infrastructure/supabase-session-verifier";

const blob = z.base64().refine((value) => Buffer.byteLength(value, "base64") >= 13);
const schema = z.object({ encryptedName: blob, encryptedOwnerVaultKey: blob, encryptionVersion: z.literal(1) });
type Dependencies = { sessionVerifier: SessionVerifier; applicationUsers: ApplicationUserRepository; sharedVaults: SharedVaultRepository };

export function createSharedVaultHandler({ sessionVerifier, applicationUsers, sharedVaults }: Dependencies) {
  return async function POST(request: NextRequest) {
    const user = await loadApplicationUser(sessionVerifier, applicationUsers);
    if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    if (!user.canAccessApplication()) return NextResponse.json({ error: "inactive_user" }, { status: 403 });
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "invalid_vault" }, { status: 400 });
    const vault = await sharedVaults.create(user.id, {
      encryptedName: Buffer.from(parsed.data.encryptedName, "base64"),
      encryptedOwnerVaultKey: Buffer.from(parsed.data.encryptedOwnerVaultKey, "base64"),
      encryptionVersion: parsed.data.encryptionVersion
    });
    return NextResponse.json({ id: vault.id }, { status: 201 });
  };
}

export const POST = createSharedVaultHandler({
  sessionVerifier: new SupabaseSessionVerifier(),
  applicationUsers: new PrismaApplicationUserRepository(),
  sharedVaults: new PrismaSharedVaultRepository()
});
