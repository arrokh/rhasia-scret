import { Buffer } from "node:buffer";
import { NextResponse } from "next/server";
import { loadApplicationUser } from "@/modules/identity/application/load-application-user";
import { PrismaApplicationUserRepository } from "@/modules/identity/infrastructure/prisma-application-user-repository";
import { SupabaseSessionVerifier } from "@/modules/identity/infrastructure/supabase-session-verifier";
import { PrismaSharedVaultAccessRepository } from "@/modules/vault-membership/infrastructure/prisma-shared-vault-access-repository";

export async function GET(_request: Request, { params }: { params: Promise<{ vaultId: string }> }) {
  const user = await loadApplicationUser(new SupabaseSessionVerifier(), new PrismaApplicationUserRepository());
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!user.canAccessApplication()) return NextResponse.json({ error: "inactive_user" }, { status: 403 });
  const { vaultId } = await params;
  const access = await new PrismaSharedVaultAccessRepository().getForMember(user.id, vaultId);
  if (!access) return NextResponse.json({ error: "shared_vault_unavailable" }, { status: 404 });
  return NextResponse.json({
    vaultId: access.vaultId,
    encryptedName: Buffer.from(access.encryptedName).toString("base64"),
    encryptionVersion: access.encryptionVersion,
    encryptedVaultKey: Buffer.from(access.encryptedVaultKey).toString("base64"),
    keyVersion: access.keyVersion,
    accounts: access.accounts.map((account) => ({ id: account.id, encryptedPayload: Buffer.from(account.encryptedPayload).toString("base64"), encryptionVersion: account.encryptionVersion, revision: account.revision }))
  });
}
