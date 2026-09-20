import { getApiRequestContext } from "@api/http/api-context";
import { ApiResponse, type ApiRequest } from "@api/http/api-request";
import { authenticateApplicationReader } from "@api/shared/infrastructure/authenticated-application-request";
import { isBrowserAccountDeletionReadRequest, noStoreHeaders } from "@api/modules/account-deletion/server";

export async function GET(request: ApiRequest): Promise<ApiResponse> {
  if (!isBrowserAccountDeletionReadRequest(request))
    return ApiResponse.json({ error: "browser_only" }, { status: 403, headers: noStoreHeaders() });
  const user = await authenticateApplicationReader(request, "fresh-provider-user");
  if (user instanceof ApiResponse) return user;
  try {
    const preview = await getApiRequestContext(request).applicationRuntime.accountDeletion().getPreview(user.id);
    return ApiResponse.json(preview, { headers: noStoreHeaders() });
  } catch {
    return ApiResponse.json({ error: "deletion_preview_unavailable" }, { status: 503, headers: noStoreHeaders() });
  }
}
