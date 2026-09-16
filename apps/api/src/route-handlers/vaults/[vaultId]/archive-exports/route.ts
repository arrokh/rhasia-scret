import { getApiRequestContext } from "@api/http/api-context";
import { ApiResponse, type ApiRequest } from "@api/http/api-request";
import {
  createVaultAuditRepository,
  recordVaultArchiveExport,
  type VaultAuditRepository,
} from "@api/modules/audit/server";
import { authenticateApplicationMutation } from "@api/shared/infrastructure/authenticated-application-request";

export function createVaultArchiveExportAuditHandler(dependencies: {
  authenticate: typeof authenticateApplicationMutation;
  audit: VaultAuditRepository;
}) {
  return async function POST(request: ApiRequest, { params }: { params: Promise<{ vaultId: string }> }) {
    const user = await dependencies.authenticate(request, "archive_export", "fresh-provider-user");
    if (user instanceof ApiResponse) return user;
    if (requestDeclaresContent(request))
      return ApiResponse.json({ error: "archive_export_body_forbidden" }, { status: 400 });
    const { vaultId } = await params;
    const recorded = await recordVaultArchiveExport(user.id, vaultId, dependencies.audit);
    if (!recorded) return ApiResponse.json({ error: "owner_access_required" }, { status: 404 });
    return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  };
}

function requestDeclaresContent(request: Request): boolean {
  const contentLength = request.headers.get("content-length");
  return request.headers.has("content-type") || (contentLength !== null && contentLength !== "0");
}

export async function POST(request: ApiRequest, context: { params: Promise<{ vaultId: string }> }) {
  return createVaultArchiveExportAuditHandler({
    authenticate: authenticateApplicationMutation,
    audit: createVaultAuditRepository(getApiRequestContext(request).database),
  })(request, context);
}
