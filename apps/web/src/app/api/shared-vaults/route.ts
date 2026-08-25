import { Buffer } from "node:buffer";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createApplicationUserRepository, createSessionVerifier, loadApplicationUser, type ApplicationUserRepository, type SessionVerifier } from "@/modules/identity/server";
import { createSharedVaultRepository, type SharedVaultRepository } from "@/modules/vault-management/server";
import { rateLimitApplicationUser } from "@/modules/rate-limiting";
import { createSharedVaultAccessRepository, type SharedVaultAccessRepository } from "@/modules/vault-membership/server";

const blob = z.base64().refine((value) => Buffer.byteLength(value, "base64") >= 13);
const schema = z.object({ vaultId: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/).optional(), encryptedName: blob, encryptedOwnerVaultKey: blob, encryptionVersion: z.literal(1) });
type Dependencies = { sessionVerifier: SessionVerifier; applicationUsers: ApplicationUserRepository; sharedVaults: SharedVaultRepository };

export function createSharedVaultHandler({ sessionVerifier, applicationUsers, sharedVaults }: Dependencies) {
  return async function POST(request: NextRequest) {
    const user = await loadApplicationUser(sessionVerifier, applicationUsers);
    if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    if (!user.canAccessApplication()) return NextResponse.json({ error: "inactive_user" }, { status: 403 });
    const rateLimited = await rateLimitApplicationUser("vault_mutation", user.id);
    if (rateLimited) return rateLimited;
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "invalid_vault" }, { status: 400 });
    const vault = await sharedVaults.create(user.id, {
      id: parsed.data.vaultId,
      encryptedName: Buffer.from(parsed.data.encryptedName, "base64"),
      encryptedOwnerVaultKey: Buffer.from(parsed.data.encryptedOwnerVaultKey, "base64"),
      encryptionVersion: parsed.data.encryptionVersion
    });
    return NextResponse.json({ id: vault.id }, { status: 201 });
  };
}

export function createListSharedVaultsHandler({
  sessionVerifier,
  applicationUsers,
  sharedVaultAccess
}: {
  sessionVerifier: SessionVerifier;
  applicationUsers: ApplicationUserRepository;
  sharedVaultAccess: SharedVaultAccessRepository;
}) {
  return async function GET() {
    const user = await loadApplicationUser(sessionVerifier, applicationUsers);
    if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    if (!user.canAccessApplication()) return NextResponse.json({ error: "inactive_user" }, { status: 403 });
    const vaults = await sharedVaultAccess.listForMember(user.id);
    return NextResponse.json(vaults.map((vault) => ({
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
        revision: account.revision
      }))
    })));
  };
}

const sessionVerifier = createSessionVerifier();
const applicationUsers = createApplicationUserRepository();

export const GET = createListSharedVaultsHandler({
  sessionVerifier,
  applicationUsers,
  sharedVaultAccess: createSharedVaultAccessRepository()
});
export const POST = createSharedVaultHandler({
  sessionVerifier,
  applicationUsers,
  sharedVaults: createSharedVaultRepository()
});
