import { NextResponse } from "next/server";
import { loadApplicationUser } from "@/modules/identity/application/load-application-user";
import { PrismaApplicationUserRepository } from "@/modules/identity/infrastructure/prisma-application-user-repository";
import { SupabaseSessionVerifier } from "@/modules/identity/infrastructure/supabase-session-verifier";
import { listVaultParticipantsForOwner } from "@/modules/vault-membership/application/manage-vault-participants";
import { PrismaVaultParticipantRepository } from "@/modules/vault-membership/infrastructure/prisma-vault-participant-repository";

export async function GET(_request: Request, { params }: { params: Promise<{ vaultId: string }> }) {
  const user = await loadApplicationUser(new SupabaseSessionVerifier(), new PrismaApplicationUserRepository());
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!user.canAccessApplication()) return NextResponse.json({ error: "inactive_user" }, { status: 403 });
  const { vaultId } = await params;
  const participants = await listVaultParticipantsForOwner(user.id, vaultId, new PrismaVaultParticipantRepository());
  if (!participants) return NextResponse.json({ error: "owner_access_required" }, { status: 404 });
  return NextResponse.json({
    participants: participants.map((participant) => ({
      ...participant,
      invitedAt: participant.invitedAt?.toISOString() ?? null
    }))
  });
}
