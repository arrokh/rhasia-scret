import { NextResponse } from "next/server";
import { loadApplicationUser } from "@/modules/identity/application/load-application-user";
import { PrismaApplicationUserRepository } from "@/modules/identity/infrastructure/prisma-application-user-repository";
import { SupabaseSessionVerifier } from "@/modules/identity/infrastructure/supabase-session-verifier";
import { rateLimitApplicationUser } from "@/modules/rate-limiting";
import { cancelPendingVaultInvitation } from "@/modules/vault-membership/application/manage-vault-participants";
import { PrismaVaultParticipantRepository } from "@/modules/vault-membership/infrastructure/prisma-vault-participant-repository";

export async function DELETE(_request: Request, { params }: { params: Promise<{ vaultId: string; invitationId: string }> }) {
  const user = await loadApplicationUser(new SupabaseSessionVerifier(), new PrismaApplicationUserRepository());
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!user.canAccessApplication()) return NextResponse.json({ error: "inactive_user" }, { status: 403 });
  const rateLimited = await rateLimitApplicationUser("membership_mutation", user.id);
  if (rateLimited) return rateLimited;
  const { vaultId, invitationId } = await params;
  const cancelled = await cancelPendingVaultInvitation(user.id, vaultId, invitationId, new PrismaVaultParticipantRepository());
  if (!cancelled) return NextResponse.json({ error: "invitation_unavailable" }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
