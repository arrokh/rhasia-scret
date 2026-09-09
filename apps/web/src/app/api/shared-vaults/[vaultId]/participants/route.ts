import { NextResponse } from "next/server";
import {
  createVaultParticipantRepository,
  listVaultParticipantsForOwner,
  parseVaultParticipantCursorKey,
} from "@/modules/vault-membership/server";
import { authenticateApplicationReader } from "@/shared/infrastructure/authenticated-application-request";
import { encodeTimestampCursor, parseTimestampCursorPageRequest } from "@/shared/infrastructure/timestamp-cursor-codec";

export async function GET(request: Request, { params }: { params: Promise<{ vaultId: string }> }) {
  const user = await authenticateApplicationReader("fresh-provider-user");
  if (user instanceof NextResponse) return user;
  const { vaultId } = await params;
  const scope = `vault-participants:${vaultId}`;
  const pagination = parseTimestampCursorPageRequest(
    new URL(request.url).searchParams,
    scope,
    (key) => parseVaultParticipantCursorKey(key) !== null,
  );
  if (!pagination.valid) return NextResponse.json({ error: pagination.error }, { status: 400 });
  const page = await listVaultParticipantsForOwner(
    user.id,
    vaultId,
    pagination.request,
    createVaultParticipantRepository(),
  );
  if (!page) return NextResponse.json({ error: "owner_access_required" }, { status: 404 });
  return NextResponse.json({
    owner: page.owner,
    vaultDefaultAccountPermissions: page.vaultDefaultAccountPermissions,
    vaultDefaultAccountPermissionsRevision: page.vaultDefaultAccountPermissionsRevision,
    participants: page.items.map((participant) => ({
      ...participant,
      invitedAt: participant.invitedAt.toISOString(),
      expiresAt: participant.expiresAt?.toISOString() ?? null,
    })),
    nextCursor: page.nextCursor ? encodeTimestampCursor(page.nextCursor, scope) : null,
  });
}
