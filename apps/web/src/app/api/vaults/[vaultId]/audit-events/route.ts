import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createApplicationUserRepository, createSessionVerifier, loadApplicationUser } from "@/modules/identity/server";
import { createVaultAuditRepository, listVaultAuditForOwner, recordPersonalVaultAccountCopiesToLocal } from "@/modules/audit/server";
import { rateLimitApplicationUser } from "@/modules/rate-limiting";
import { encodeTimestampCursor, parseTimestampCursorPageRequest } from "@/shared/infrastructure/timestamp-cursor-codec";

const auditFilterSchema = z.object({ accountId: z.string().min(1).max(128).optional(), actorUserId: z.string().min(1).max(128).optional() });
const localCopyAuditSchema = z.object({
  eventType: z.literal("ACCOUNT_COPIED_TO_LOCAL"),
  accountIds: z.array(z.string().min(1).max(128)).min(1).max(500).refine((ids) => new Set(ids).size === ids.length)
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ vaultId: string }> }) {
  const user = await loadApplicationUser(createSessionVerifier(), createApplicationUserRepository());
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!user.canAccessApplication()) return NextResponse.json({ error: "inactive_user" }, { status: 403 });
  const rateLimited = await rateLimitApplicationUser("account_mutation", user.id);
  if (rateLimited) return rateLimited;
  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "invalid_copy_audit" }, { status: 400 }); }
  const parsed = localCopyAuditSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_copy_audit" }, { status: 400 });
  const { vaultId } = await params;
  const recorded = await recordPersonalVaultAccountCopiesToLocal(user.id, vaultId, parsed.data.accountIds, createVaultAuditRepository());
  return recorded ? new NextResponse(null, { status: 204 }) : NextResponse.json({ error: "owner_access_required" }, { status: 404 });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ vaultId: string }> }) {
  const user = await loadApplicationUser(createSessionVerifier(), createApplicationUserRepository());
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!user.canAccessApplication()) return NextResponse.json({ error: "inactive_user" }, { status: 403 });
  const parsedFilter = auditFilterSchema.safeParse({
    accountId: request.nextUrl.searchParams.get("accountId") ?? undefined,
    actorUserId: request.nextUrl.searchParams.get("actorUserId") ?? undefined
  });
  if (!parsedFilter.success) return NextResponse.json({ error: "invalid_audit_filter" }, { status: 400 });
  const { vaultId } = await params;
  const scope = JSON.stringify(["vault-audit", vaultId, parsedFilter.data.accountId ?? null, parsedFilter.data.actorUserId ?? null]);
  const pagination = parseTimestampCursorPageRequest(request.nextUrl.searchParams, scope);
  if (!pagination.valid) return NextResponse.json({ error: pagination.error }, { status: 400 });
  const page = await listVaultAuditForOwner(user.id, vaultId, parsedFilter.data, pagination.request, createVaultAuditRepository());
  if (!page) return NextResponse.json({ error: "owner_access_required" }, { status: 404 });
  return NextResponse.json({
    events: page.items.map((event) => ({ id: event.id, eventType: event.eventType, targetId: event.targetId, actorUserId: event.actorUserId, actorEmail: event.actorEmail, createdAt: event.createdAt.toISOString() })),
    nextCursor: page.nextCursor ? encodeTimestampCursor(page.nextCursor, scope) : null
  }, { headers: { "cache-control": "no-store" } });
}
