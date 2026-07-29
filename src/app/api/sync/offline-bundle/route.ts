import { NextResponse } from "next/server";
import { loadApplicationUser } from "@/modules/identity";
import type { ApplicationUserRepository, SessionVerifier } from "@/modules/identity";
import { createApplicationUserRepository } from "@/modules/identity/server";
import { createSessionVerifier } from "@/modules/identity/server";
import type { OfflineSyncBundleReader } from "@/modules/sync";
import { PrismaOfflineSyncBundleReader } from "@/modules/sync/infrastructure/prisma-offline-sync-bundle-reader";

export function createOfflineSyncBundleHandler({
  sessionVerifier,
  applicationUsers,
  bundles
}: {
  sessionVerifier: SessionVerifier;
  applicationUsers: ApplicationUserRepository;
  bundles: OfflineSyncBundleReader;
}) {
  return async function GET(request?: Request) {
    const user = await loadApplicationUser(sessionVerifier, applicationUsers);
    if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    if (!user.canAccessApplication()) return NextResponse.json({ error: "inactive_user" }, { status: 403 });
    const bundle = await bundles.readAuthorizedBundle(user.id);
    if (!bundle) return NextResponse.json({ error: "not_initialized" }, { status: 404 });
    const etag = `"${bundle.synchronizationToken}"`;
    const headers = { "cache-control": "no-store, private", etag, "x-synchronized-at": bundle.synchronizedAt };
    if (request?.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
    return NextResponse.json(bundle, { headers });
  };
}

export const GET = createOfflineSyncBundleHandler({
  sessionVerifier: createSessionVerifier(),
  applicationUsers: createApplicationUserRepository(),
  bundles: new PrismaOfflineSyncBundleReader()
});
