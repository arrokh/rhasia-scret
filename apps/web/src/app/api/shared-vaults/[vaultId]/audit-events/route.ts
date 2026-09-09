import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createVaultAuditRepository, recordSharedVaultAccountAccess } from "@/modules/audit/server";
import { authenticateApplicationMutation } from "@/shared/infrastructure/authenticated-application-request";

export { GET } from "@/app/api/vaults/[vaultId]/audit-events/route";

const accessSchema = z.object({ eventType: z.literal("ACCOUNT_ACCESSED"), accountId: z.string().min(1) });

export async function POST(request: NextRequest, { params }: { params: Promise<{ vaultId: string }> }) {
  const user = await authenticateApplicationMutation("audit_event", "fresh-provider-user");
  if (user instanceof NextResponse) return user;
  const parsed = accessSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_audit_event" }, { status: 400 });
  const { vaultId } = await params;
  const recorded = await recordSharedVaultAccountAccess(
    user.id,
    vaultId,
    parsed.data.accountId,
    createVaultAuditRepository(),
  );
  if (!recorded) return NextResponse.json({ error: "shared_vault_access_required" }, { status: 404 });
  return new Response(null, { status: 204 });
}
