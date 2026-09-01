import { NextResponse, type NextRequest } from "next/server";
import { createVaultAuditRepository, recordVaultArchiveExport, type VaultAuditRepository } from "@/modules/audit/server";
import { authenticateApplicationMutation } from "@/shared/infrastructure/authenticated-application-request";

export function createVaultArchiveExportAuditHandler(dependencies: {
  authenticate: typeof authenticateApplicationMutation;
  audit: VaultAuditRepository;
}) {
  return async function POST(_request: NextRequest, { params }: { params: Promise<{ vaultId: string }> }) {
    const user = await dependencies.authenticate("archive_export", "fresh-provider-user");
    if (user instanceof NextResponse) return user;
    if (requestDeclaresContent(_request)) return NextResponse.json({ error: "archive_export_body_forbidden" }, { status: 400 });
    const { vaultId } = await params;
    const recorded = await recordVaultArchiveExport(user.id, vaultId, dependencies.audit);
    if (!recorded) return NextResponse.json({ error: "owner_access_required" }, { status: 404 });
    return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  };
}

function requestDeclaresContent(request: Request): boolean {
  const contentLength = request.headers.get("content-length");
  return request.headers.has("content-type") || (contentLength !== null && contentLength !== "0");
}

export const POST = createVaultArchiveExportAuditHandler({
  authenticate: authenticateApplicationMutation,
  audit: createVaultAuditRepository()
});
