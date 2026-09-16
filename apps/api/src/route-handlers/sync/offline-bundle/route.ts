import { getApiRequestContext } from "@api/http/api-context";
import { ApiResponse } from "@api/http/api-request";
import { createOfflineSyncBundleReader, type OfflineSyncBundleReader } from "@api/modules/sync/server";
import { authenticateApplicationReader } from "@api/shared/infrastructure/authenticated-application-request";

export function createOfflineSyncBundleHandler({
  authenticate,
  bundles,
}: {
  authenticate: typeof authenticateApplicationReader;
  bundles: OfflineSyncBundleReader;
}) {
  return async function GET(request: Request) {
    const user = await authenticate(request, "fresh-provider-user");
    if (user instanceof ApiResponse) return user;
    const bundle = await bundles.readAuthorizedBundle(user.id);
    if (!bundle) return ApiResponse.json({ error: "not_initialized" }, { status: 404 });
    const etag = `"${bundle.synchronizationToken}"`;
    const headers = { "cache-control": "no-store, private", etag, "x-synchronized-at": bundle.synchronizedAt };
    if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
    return ApiResponse.json(bundle, { headers });
  };
}

export async function GET(request: Request) {
  return createOfflineSyncBundleHandler({
    authenticate: authenticateApplicationReader,
    bundles: createOfflineSyncBundleReader(getApiRequestContext(request).database),
  })(request);
}
