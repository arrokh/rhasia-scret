import { NextResponse } from "next/server";
import { createPersonalVaultRepository, ensurePersonalVault, type PersonalVaultRepository } from "@/modules/vault-management/server";
import { authenticateApplicationReader } from "@/shared/infrastructure/authenticated-application-request";

type Dependencies = {
  authenticate: typeof authenticateApplicationReader;
  personalVaults: PersonalVaultRepository;
};

export function createGetPersonalVaultHandler({ authenticate, personalVaults }: Dependencies) {
  return async function GET() {
    const user = await authenticate("fresh-provider-user");
    if (user instanceof NextResponse) return user;
    const vault = await ensurePersonalVault(user.id, personalVaults);
    return NextResponse.json({ id: vault.id, lifecycle: vault.lifecycle });
  };
}

export const GET = createGetPersonalVaultHandler({
  authenticate: authenticateApplicationReader,
  personalVaults: createPersonalVaultRepository()
});
