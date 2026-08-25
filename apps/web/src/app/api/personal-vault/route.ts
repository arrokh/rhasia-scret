import { NextResponse } from "next/server";
import { createApplicationUserRepository, createSessionVerifier, loadApplicationUser, type ApplicationUserRepository, type SessionVerifier } from "@/modules/identity/server";
import { createPersonalVaultRepository, ensurePersonalVault, type PersonalVaultRepository } from "@/modules/vault-management/server";

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
  sessionVerifier: createSessionVerifier(),
  applicationUsers: createApplicationUserRepository(),
  personalVaults: createPersonalVaultRepository()
});
