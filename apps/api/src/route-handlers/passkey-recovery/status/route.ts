import { getApiRequestContext } from "@api/http/api-context";
import { ApiResponse, type ApiRequest } from "@api/http/api-request";
import { authenticateApplicationReader } from "@api/shared/infrastructure/authenticated-application-request";

export async function GET(request: ApiRequest) {
  const user = await authenticateApplicationReader(request, "fresh-provider-user");
  if (user instanceof ApiResponse) return user;

  const credential = await getApiRequestContext(request).applicationRuntime.passkeyRecovery().getCredential(user.id);
  return ApiResponse.json({ enrolled: credential !== null });
}
