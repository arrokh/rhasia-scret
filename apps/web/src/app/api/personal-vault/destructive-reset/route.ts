import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createApplicationUserRepository, createSessionVerifier, loadApplicationUser, type ApplicationUserRepository, type SessionVerifier } from "@/modules/identity/server";
import { rateLimitApplicationUser } from "@/modules/rate-limiting";
import {
  ActiveOwnedSharedVaultsPreventResetError,
  createDestructivePersonalVaultResetRepository,
  InvalidDestructiveResetConfirmationError,
  PasskeyRecoveryAlreadyEnrolledError,
  destructivelyResetPersonalVault,
  type DestructivePersonalVaultResetRepository
} from "@/modules/vault-management/server";

const bodySchema = z.object({ confirmation: z.string() });

type Dependencies = {
  sessionVerifier: SessionVerifier;
  applicationUsers: ApplicationUserRepository;
  resets: DestructivePersonalVaultResetRepository;
};

export function createDestructivePersonalVaultResetHandler({ sessionVerifier, applicationUsers, resets }: Dependencies) {
  return async function POST(request: NextRequest) {
    const user = await loadApplicationUser(sessionVerifier, applicationUsers);
    if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    if (!user.canAccessApplication()) return NextResponse.json({ error: "inactive_user" }, { status: 403 });
    const rateLimited = await rateLimitApplicationUser("destructive_mutation", user.id);
    if (rateLimited) return rateLimited;
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "invalid_confirmation" }, { status: 400 });

    try {
      await destructivelyResetPersonalVault(user.id, parsed.data.confirmation, resets);
      return new NextResponse(null, { status: 204 });
    } catch (error) {
      if (error instanceof InvalidDestructiveResetConfirmationError) {
        return NextResponse.json({ error: "invalid_confirmation" }, { status: 400 });
      }
      if (error instanceof PasskeyRecoveryAlreadyEnrolledError) {
        return NextResponse.json({ error: "passkey_recovery_available" }, { status: 409 });
      }
      if (error instanceof ActiveOwnedSharedVaultsPreventResetError) {
        return NextResponse.json({ error: "owned_shared_vaults_exist", count: error.count }, { status: 409 });
      }
      return NextResponse.json({ error: "destructive_reset_failed" }, { status: 500 });
    }
  };
}

export const POST = createDestructivePersonalVaultResetHandler({
  sessionVerifier: createSessionVerifier(),
  applicationUsers: createApplicationUserRepository(),
  resets: createDestructivePersonalVaultResetRepository()
});
