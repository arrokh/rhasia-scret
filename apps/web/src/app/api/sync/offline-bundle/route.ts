import { NextResponse } from "next/server";
import { createOfflineSyncBundleReader, type OfflineSyncBundleReader } from "@/modules/sync/server";
import { authenticateApplicationReader } from "@/shared/infrastructure/authenticated-application-request";

export function createOfflineSyncBundleHandler({
  authenticate,
  bundles
}: {
  authenticate: typeof authenticateApplicationReader;
  bundles: OfflineSyncBundleReader;
}) {
  return async function GET(request?: Request) {
    const user = await authenticate("fresh-provider-user");
    if (user instanceof NextResponse) return user;
    const bundle = await bundles.readAuthorizedBundle(user.id);
    if (!bundle) return NextResponse.json({ error: "not_initialized" }, { status: 404 });
    const etag = `"${bundle.synchronizationToken}"`;
    const headers = { "cache-control": "no-store, private", etag, "x-synchronized-at": bundle.synchronizedAt };
    if (request?.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
    return NextResponse.json(bundle, { headers });
  };
}

export const GET = createOfflineSyncBundleHandler({
  authenticate: authenticateApplicationReader,
  bundles: createOfflineSyncBundleReader()
});
