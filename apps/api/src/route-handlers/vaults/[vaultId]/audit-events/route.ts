import { getApiRequestContext } from "@api/http/api-context";
import { ApiResponse, type ApiRequest } from "@api/http/api-request";
import { z } from "zod";
import {
  createVaultAuditRepository,
  listVaultAuditForOwner,
  recordPersonalVaultAccountCopiesToLocal,
} from "@api/modules/audit/server";
import {
  authenticateApplicationMutation,
  authenticateApplicationReader,
} from "@api/shared/infrastructure/authenticated-application-request";
import {
  encodeTimestampCursor,
  parseTimestampCursorPageRequest,
} from "@api/shared/infrastructure/timestamp-cursor-codec";

const auditFilterSchema = z.object({
  accountId: z.string().min(1).max(128).optional(),
  actorUserId: z.string().min(1).max(128).optional(),
});
const localCopyAuditSchema = z.object({
  eventType: z.literal("ACCOUNT_COPIED_TO_LOCAL"),
  accountIds: z
    .array(z.string().min(1).max(128))
    .min(1)
    .max(500)
    .refine((ids) => new Set(ids).size === ids.length),
});

export async function POST(request: ApiRequest, { params }: { params: Promise<{ vaultId: string }> }) {
  const user = await authenticateApplicationMutation(request, "account_mutation", "fresh-provider-user");
  if (user instanceof ApiResponse) return user;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return ApiResponse.json({ error: "invalid_copy_audit" }, { status: 400 });
  }
  const parsed = localCopyAuditSchema.safeParse(body);
  if (!parsed.success) return ApiResponse.json({ error: "invalid_copy_audit" }, { status: 400 });
  const { vaultId } = await params;
  const recorded = await recordPersonalVaultAccountCopiesToLocal(
    user.id,
    vaultId,
    parsed.data.accountIds,
    createVaultAuditRepository(getApiRequestContext(request).database),
  );
  return recorded
    ? new ApiResponse(null, { status: 204 })
    : ApiResponse.json({ error: "owner_access_required" }, { status: 404 });
}

export async function GET(request: ApiRequest, { params }: { params: Promise<{ vaultId: string }> }) {
  const user = await authenticateApplicationReader(request, "fresh-provider-user");
  if (user instanceof ApiResponse) return user;
  const parsedFilter = auditFilterSchema.safeParse({
    accountId: request.nextUrl.searchParams.get("accountId") ?? undefined,
    actorUserId: request.nextUrl.searchParams.get("actorUserId") ?? undefined,
  });
  if (!parsedFilter.success) return ApiResponse.json({ error: "invalid_audit_filter" }, { status: 400 });
  const { vaultId } = await params;
  const scope = JSON.stringify([
    "vault-audit",
    vaultId,
    parsedFilter.data.accountId ?? null,
    parsedFilter.data.actorUserId ?? null,
  ]);
  const pagination = parseTimestampCursorPageRequest(request.nextUrl.searchParams, scope);
  if (!pagination.valid) return ApiResponse.json({ error: pagination.error }, { status: 400 });
  const page = await listVaultAuditForOwner(
    user.id,
    vaultId,
    parsedFilter.data,
    pagination.request,
    createVaultAuditRepository(getApiRequestContext(request).database),
  );
  if (!page) return ApiResponse.json({ error: "owner_access_required" }, { status: 404 });
  return ApiResponse.json(
    {
      events: page.items.map((event) => ({
        id: event.id,
        eventType: event.eventType,
        targetId: event.targetId,
        actorUserId: event.actorUserId,
        actorEmail: event.actorEmail,
        createdAt: event.createdAt.toISOString(),
      })),
      nextCursor: page.nextCursor ? encodeTimestampCursor(page.nextCursor, scope) : null,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
