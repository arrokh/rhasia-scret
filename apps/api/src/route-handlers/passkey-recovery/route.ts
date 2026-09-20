import { getApiRequestContext } from "@api/http/api-context";
import { ApiResponse, type ApiRequest } from "@api/http/api-request";
import { authenticateApplicationMutation } from "@api/shared/infrastructure/authenticated-application-request";

export async function DELETE(request: ApiRequest) {
  const user = await authenticateApplicationMutation(request, "recovery_mutation", "fresh-provider-user");
  if (user instanceof ApiResponse) return user;

  await getApiRequestContext(request).applicationRuntime.passkeyRecovery().removeCredential(user.id);
  return new Response(null, { status: 204 });
}
