import { getApiRequestContext } from "@api/http/api-context";
import { ApiResponse, type ApiRequest } from "@api/http/api-request";
import { safeParseJsonBody } from "@api/http/validation";
import { z } from "zod";
import { recordSharedVaultAccountAccess } from "@api/modules/audit/server";
import { authenticateApplicationMutation } from "@api/shared/infrastructure/authenticated-application-request";

// GET is mounted by the API route composition.

const accessSchema = z
  .object({ eventType: z.literal("ACCOUNT_ACCESSED"), accountId: z.string().min(1).max(128) })
  .strict();

export async function POST(request: ApiRequest, { params }: { params: Promise<{ vaultId: string }> }) {
  const user = await authenticateApplicationMutation(request, "audit_event", "fresh-provider-user");
  if (user instanceof ApiResponse) return user;
  const parsed = await safeParseJsonBody(request, accessSchema);
  if (!parsed.success) return ApiResponse.json({ error: "invalid_audit_event" }, { status: 400 });
  const { vaultId } = await params;
  const recorded = await recordSharedVaultAccountAccess(
    user.id,
    vaultId,
    parsed.data.accountId,
    getApiRequestContext(request).applicationRuntime.vaultAudit(),
  );
  if (!recorded) return ApiResponse.json({ error: "shared_vault_access_required" }, { status: 404 });
  return new Response(null, { status: 204 });
}
