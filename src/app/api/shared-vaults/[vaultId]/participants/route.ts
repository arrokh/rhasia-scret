import { NextResponse } from "next/server";
import { loadApplicationUser } from "@/modules/identity/application/load-application-user";
import { createApplicationUserRepository, createSessionVerifier } from "@/modules/identity/server";
import { listVaultParticipantsForOwner } from "@/modules/vault-membership/application/manage-vault-participants";
import { parseVaultParticipantCursorKey } from "@/modules/vault-membership/application/vault-participant-repository";
import { PrismaVaultParticipantRepository } from "@/modules/vault-membership/infrastructure/prisma-vault-participant-repository";
import { encodeTimestampCursor, parseTimestampCursorPageRequest } from "@/shared/infrastructure/timestamp-cursor-codec";

export async function GET(request: Request, { params }: { params: Promise<{ vaultId: string }> }) {
  const user = await loadApplicationUser(createSessionVerifier(), createApplicationUserRepository());
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!user.canAccessApplication()) return NextResponse.json({ error: "inactive_user" }, { status: 403 });
  const { vaultId } = await params;
  const scope = `vault-participants:${vaultId}`;
  const pagination = parseTimestampCursorPageRequest(new URL(request.url).searchParams, scope, (key) => parseVaultParticipantCursorKey(key) !== null);
  if (!pagination.valid) return NextResponse.json({ error: pagination.error }, { status: 400 });
  const page = await listVaultParticipantsForOwner(user.id, vaultId, pagination.request, new PrismaVaultParticipantRepository());
  if (!page) return NextResponse.json({ error: "owner_access_required" }, { status: 404 });
  return NextResponse.json({
    owner: page.owner,
    vaultDefaultAccountPermissions: page.vaultDefaultAccountPermissions,
    vaultDefaultAccountPermissionsRevision: page.vaultDefaultAccountPermissionsRevision,
    participants: page.items.map((participant) => ({ ...participant, invitedAt: participant.invitedAt.toISOString(), expiresAt: participant.expiresAt?.toISOString() ?? null })),
    nextCursor: page.nextCursor ? encodeTimestampCursor(page.nextCursor, scope) : null
  });
}
