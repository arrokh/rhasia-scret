import { NextResponse } from "next/server";
import { loadApplicationUser } from "@/modules/identity/application/load-application-user";
import type { ApplicationUserRepository } from "@/modules/identity/application/application-user-repository";
import type { SessionVerifier } from "@/modules/identity/application/session-verifier";
import { PrismaApplicationUserRepository } from "@/modules/identity/infrastructure/prisma-application-user-repository";
import { ensurePersonalVault } from "@/modules/vault-management/application/ensure-personal-vault";
import type { PersonalVaultRepository } from "@/modules/vault-management/application/personal-vault-repository";
import { PrismaPersonalVaultRepository } from "@/modules/vault-management/infrastructure/prisma-personal-vault-repository";
import { SupabaseSessionVerifier } from "@/modules/identity/infrastructure/supabase-session-verifier";

type Dependencies = {
  sessionVerifier: SessionVerifier;
  applicationUsers: ApplicationUserRepository;
  personalVaults: PersonalVaultRepository;
};

export function createGetPersonalVaultHandler({ sessionVerifier, applicationUsers, personalVaults }: Dependencies) {
  return async function GET() {
    const user = await loadApplicationUser(sessionVerifier, applicationUsers);
    if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    if (!user.canAccessApplication()) return NextResponse.json({ error: "inactive_user" }, { status: 403 });
    const vault = await ensurePersonalVault(user.id, personalVaults);
    return NextResponse.json({ id: vault.id, lifecycle: vault.lifecycle });
  };
}

export const GET = createGetPersonalVaultHandler({
  sessionVerifier: new SupabaseSessionVerifier(),
  applicationUsers: new PrismaApplicationUserRepository(),
  personalVaults: new PrismaPersonalVaultRepository()
});
