import { getApiRequestContext } from "@api/http/api-context";
import { ApiResponse } from "@api/http/api-request";
import {
  createVaultParticipantRepository,
  listVaultParticipantsForOwner,
  parseVaultParticipantCursorKey,
} from "@api/modules/vault-membership/server";
import { authenticateApplicationReader } from "@api/shared/infrastructure/authenticated-application-request";
import {
  encodeTimestampCursor,
  parseTimestampCursorPageRequest,
} from "@api/shared/infrastructure/timestamp-cursor-codec";

export async function GET(request: Request, { params }: { params: Promise<{ vaultId: string }> }) {
  const user = await authenticateApplicationReader(request, "fresh-provider-user");
  if (user instanceof ApiResponse) return user;
  const { vaultId } = await params;
  const scope = `vault-participants:${vaultId}`;
  const pagination = parseTimestampCursorPageRequest(
    new URL(request.url).searchParams,
    scope,
    (key) => parseVaultParticipantCursorKey(key) !== null,
  );
  if (!pagination.valid) return ApiResponse.json({ error: pagination.error }, { status: 400 });
  const page = await listVaultParticipantsForOwner(
    user.id,
    vaultId,
    pagination.request,
    createVaultParticipantRepository(getApiRequestContext(request).database),
  );
  if (!page) return ApiResponse.json({ error: "owner_access_required" }, { status: 404 });
  return ApiResponse.json({
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
