import { Buffer } from "node:buffer";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createSharedVaultAccessRepository } from "@/modules/vault-membership/server";
import { createSharedVaultRepository, type SharedVaultRepository } from "@/modules/vault-management/server";
import {
  authenticateApplicationMutation,
  authenticateApplicationReader,
} from "@/shared/infrastructure/authenticated-application-request";

const renameSchema = z.object({
  encryptedName: z.base64().refine((value) => Buffer.byteLength(value, "base64") >= 13),
  encryptionVersion: z.literal(1),
});

export async function GET(_request: Request, { params }: { params: Promise<{ vaultId: string }> }) {
  const user = await authenticateApplicationReader("fresh-provider-user");
  if (user instanceof NextResponse) return user;
  const { vaultId } = await params;
  const access = await createSharedVaultAccessRepository().getForMember(user.id, vaultId);
  if (!access) return NextResponse.json({ error: "shared_vault_unavailable" }, { status: 404 });
  return NextResponse.json({
    vaultId: access.vaultId,
    effectiveAccountPermissions: access.effectiveAccountPermissions,
    encryptedName: Buffer.from(access.encryptedName).toString("base64"),
    encryptionVersion: access.encryptionVersion,
    encryptedVaultKey: Buffer.from(access.encryptedVaultKey).toString("base64"),
    keyVersion: access.keyVersion,
    accounts: access.accounts.map((account) => ({
      id: account.id,
      encryptedPayload: Buffer.from(account.encryptedPayload).toString("base64"),
      encryptionVersion: account.encryptionVersion,
      revision: account.revision,
    })),
  });
}

export function createRenameSharedVaultHandler({
  authenticate,
  sharedVaults,
}: {
  authenticate: typeof authenticateApplicationMutation;
  sharedVaults: SharedVaultRepository;
}) {
  return async (request: NextRequest, { params }: { params: Promise<{ vaultId: string }> }) => {
    const user = await authenticate("vault_mutation", "fresh-provider-user");
    if (user instanceof NextResponse) return user;
    const parsed = renameSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "invalid_vault_name" }, { status: 400 });
    const { vaultId } = await params;
    const renamed = await sharedVaults.rename(
      user.id,
      vaultId,
      Buffer.from(parsed.data.encryptedName, "base64"),
      parsed.data.encryptionVersion,
    );
    return renamed
      ? new NextResponse(null, { status: 204 })
      : NextResponse.json({ error: "owner_access_required" }, { status: 404 });
  };
}

export const PATCH = createRenameSharedVaultHandler({
  authenticate: authenticateApplicationMutation,
  sharedVaults: createSharedVaultRepository(),
});
