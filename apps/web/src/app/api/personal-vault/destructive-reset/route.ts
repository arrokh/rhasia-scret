import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  ActiveOwnedSharedVaultsPreventResetError,
  createDestructivePersonalVaultResetRepository,
  InvalidDestructiveResetConfirmationError,
  PasskeyRecoveryAlreadyEnrolledError,
  destructivelyResetPersonalVault,
  type DestructivePersonalVaultResetRepository
} from "@/modules/vault-management/server";
import { authenticateApplicationMutation } from "@/shared/infrastructure/authenticated-application-request";

const bodySchema = z.object({ confirmation: z.string() });

type Dependencies = {
  authenticate: typeof authenticateApplicationMutation;
  resets: DestructivePersonalVaultResetRepository;
};

export function createDestructivePersonalVaultResetHandler({ authenticate, resets }: Dependencies) {
  return async function POST(request: NextRequest) {
    const user = await authenticate("destructive_mutation", "fresh-provider-user");
    if (user instanceof NextResponse) return user;
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
  authenticate: authenticateApplicationMutation,
  resets: createDestructivePersonalVaultResetRepository()
});
