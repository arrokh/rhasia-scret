import { Buffer } from "node:buffer";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createSharedVaultRepository, type SharedVaultRepository } from "@/modules/vault-management/server";
import { createSharedVaultAccessRepository, type SharedVaultAccessRepository } from "@/modules/vault-membership/server";
import {
  authenticateApplicationMutation,
  authenticateApplicationReader,
} from "@/shared/infrastructure/authenticated-application-request";

const blob = z.base64().refine((value) => Buffer.byteLength(value, "base64") >= 13);
const schema = z.object({
  vaultId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{16,128}$/)
    .optional(),
  encryptedName: blob,
  encryptedOwnerVaultKey: blob,
  encryptionVersion: z.literal(1),
});
type Dependencies = {
  authenticate: typeof authenticateApplicationMutation;
  sharedVaults: SharedVaultRepository;
};

export function createSharedVaultHandler({ authenticate, sharedVaults }: Dependencies) {
  return async function POST(request: NextRequest) {
    const user = await authenticate("vault_mutation", "fresh-provider-user");
    if (user instanceof NextResponse) return user;
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "invalid_vault" }, { status: 400 });
    const vault = await sharedVaults.create(user.id, {
      id: parsed.data.vaultId,
      encryptedName: Buffer.from(parsed.data.encryptedName, "base64"),
      encryptedOwnerVaultKey: Buffer.from(parsed.data.encryptedOwnerVaultKey, "base64"),
      encryptionVersion: parsed.data.encryptionVersion,
    });
    return NextResponse.json({ id: vault.id }, { status: 201 });
  };
}

export function createListSharedVaultsHandler({
  authenticate,
  sharedVaultAccess,
}: {
  authenticate: typeof authenticateApplicationReader;
  sharedVaultAccess: SharedVaultAccessRepository;
}) {
  return async function GET() {
    const user = await authenticate("fresh-provider-user");
    if (user instanceof NextResponse) return user;
    const vaults = await sharedVaultAccess.listForMember(user.id);
    return NextResponse.json(
      vaults.map((vault) => ({
        vaultId: vault.vaultId,
        role: vault.role,
        effectiveAccountPermissions: vault.effectiveAccountPermissions,
        encryptedName: Buffer.from(vault.encryptedName).toString("base64"),
        encryptionVersion: vault.encryptionVersion,
        encryptedVaultKey: Buffer.from(vault.encryptedVaultKey).toString("base64"),
        keyVersion: vault.keyVersion,
        accounts: vault.accounts.map((account) => ({
          id: account.id,
          encryptedPayload: Buffer.from(account.encryptedPayload).toString("base64"),
          encryptionVersion: account.encryptionVersion,
          revision: account.revision,
        })),
      })),
    );
  };
}

export const GET = createListSharedVaultsHandler({
  authenticate: authenticateApplicationReader,
  sharedVaultAccess: createSharedVaultAccessRepository(),
});
export const POST = createSharedVaultHandler({
  authenticate: authenticateApplicationMutation,
  sharedVaults: createSharedVaultRepository(),
});
