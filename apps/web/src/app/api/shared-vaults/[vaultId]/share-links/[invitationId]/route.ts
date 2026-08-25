import { NextResponse } from "next/server";
import { createApplicationUserRepository, createSessionVerifier, loadApplicationUser } from "@/modules/identity/server";
import { rateLimitApplicationUser } from "@/modules/rate-limiting";
import { cancelPendingVaultInvitation, createVaultParticipantRepository } from "@/modules/vault-membership/server";

export async function DELETE(_request: Request, { params }: { params: Promise<{ vaultId: string; invitationId: string }> }) {
  const user = await loadApplicationUser(createSessionVerifier(), createApplicationUserRepository());
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!user.canAccessApplication()) return NextResponse.json({ error: "inactive_user" }, { status: 403 });
  const rateLimited = await rateLimitApplicationUser("membership_mutation", user.id);
  if (rateLimited) return rateLimited;
  const { vaultId, invitationId } = await params;
  const cancelled = await cancelPendingVaultInvitation(user.id, vaultId, invitationId, createVaultParticipantRepository());
  if (!cancelled) return NextResponse.json({ error: "invitation_unavailable" }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
