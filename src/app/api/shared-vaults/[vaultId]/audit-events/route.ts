import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { loadApplicationUser } from "@/modules/identity/application/load-application-user";
import { PrismaApplicationUserRepository } from "@/modules/identity/infrastructure/prisma-application-user-repository";
import { SupabaseSessionVerifier } from "@/modules/identity/infrastructure/supabase-session-verifier";
import { rateLimitApplicationUser } from "@/modules/rate-limiting";
import { listSharedVaultAuditForOwner, recordSharedVaultAccountAccess } from "@/modules/vault-management/application/manage-vault-audit";
import { PrismaVaultAuditRepository } from "@/modules/vault-management/infrastructure/prisma-vault-audit-repository";

const accessSchema = z.object({ eventType: z.literal("ACCOUNT_ACCESSED"), accountId: z.string().min(1) });
const auditFilterSchema = z.object({ accountId: z.string().min(1).max(128).optional(), actorUserId: z.string().min(1).max(128).optional() });

export async function GET(request: NextRequest, { params }: { params: Promise<{ vaultId: string }> }) {
  const user = await loadApplicationUser(new SupabaseSessionVerifier(), new PrismaApplicationUserRepository());
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!user.canAccessApplication()) return NextResponse.json({ error: "inactive_user" }, { status: 403 });
  const parsedFilter = auditFilterSchema.safeParse({
    accountId: request.nextUrl.searchParams.get("accountId") ?? undefined,
    actorUserId: request.nextUrl.searchParams.get("actorUserId") ?? undefined
  });
  if (!parsedFilter.success) return NextResponse.json({ error: "invalid_audit_filter" }, { status: 400 });
  const { vaultId } = await params;
  const events = await listSharedVaultAuditForOwner(user.id, vaultId, parsedFilter.data, new PrismaVaultAuditRepository());
  if (!events) return NextResponse.json({ error: "owner_access_required" }, { status: 404 });
  return NextResponse.json({ events: events.map((event) => ({ id: event.id, eventType: event.eventType, targetId: event.targetId, actorUserId: event.actorUserId, actorEmail: event.actorEmail, createdAt: event.createdAt.toISOString() })) });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ vaultId: string }> }) {
  const user = await loadApplicationUser(new SupabaseSessionVerifier(), new PrismaApplicationUserRepository());
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!user.canAccessApplication()) return NextResponse.json({ error: "inactive_user" }, { status: 403 });
  const rateLimited = await rateLimitApplicationUser("audit_event", user.id);
  if (rateLimited) return rateLimited;
  const parsed = accessSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_audit_event" }, { status: 400 });
  const { vaultId } = await params;
  const recorded = await recordSharedVaultAccountAccess(user.id, vaultId, parsed.data.accountId, new PrismaVaultAuditRepository());
  if (!recorded) return NextResponse.json({ error: "shared_vault_access_required" }, { status: 404 });
  return new Response(null, { status: 204 });
}
