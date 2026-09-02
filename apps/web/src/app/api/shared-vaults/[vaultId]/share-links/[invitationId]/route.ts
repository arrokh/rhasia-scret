import { NextResponse } from "next/server";
import { cancelPendingVaultInvitation, createVaultParticipantRepository } from "@/modules/vault-membership/server";
import { authenticateApplicationMutation } from "@/shared/infrastructure/authenticated-application-request";

export async function DELETE(_request: Request, { params }: { params: Promise<{ vaultId: string; invitationId: string }> }) {
  const user = await authenticateApplicationMutation("membership_mutation", "fresh-provider-user");
  if (user instanceof NextResponse) return user;
  const { vaultId, invitationId } = await params;
  const cancelled = await cancelPendingVaultInvitation(user.id, vaultId, invitationId, createVaultParticipantRepository());
  if (!cancelled) return NextResponse.json({ error: "invitation_unavailable" }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
