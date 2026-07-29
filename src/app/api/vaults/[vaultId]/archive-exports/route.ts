import { NextResponse, type NextRequest } from "next/server";
import { loadApplicationUser } from "@/modules/identity/application/load-application-user";
import type { ApplicationUserRepository } from "@/modules/identity/application/application-user-repository";
import type { SessionVerifier } from "@/modules/identity/application/session-verifier";
import { createApplicationUserRepository } from "@/modules/identity/server";
import { createSessionVerifier } from "@/modules/identity/server";
import { rateLimitApplicationUser } from "@/modules/rate-limiting";
import { recordVaultArchiveExport, type VaultAuditRepository } from "@/modules/vault-management/application/manage-vault-audit";
import { PrismaVaultAuditRepository } from "@/modules/vault-management/infrastructure/prisma-vault-audit-repository";

export function createVaultArchiveExportAuditHandler(dependencies: {
  sessionVerifier: SessionVerifier;
  applicationUsers: ApplicationUserRepository;
  audit: VaultAuditRepository;
}) {
  return async function POST(_request: NextRequest, { params }: { params: Promise<{ vaultId: string }> }) {
    const user = await loadApplicationUser(dependencies.sessionVerifier, dependencies.applicationUsers);
    if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    if (!user.canAccessApplication()) return NextResponse.json({ error: "inactive_user" }, { status: 403 });
    const rateLimited = await rateLimitApplicationUser("archive_export", user.id);
    if (rateLimited) return rateLimited;
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
  sessionVerifier: createSessionVerifier(),
  applicationUsers: createApplicationUserRepository(),
  audit: new PrismaVaultAuditRepository()
});
