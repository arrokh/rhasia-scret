import { getApiRequestContext } from "@api/http/api-context";
import { ApiResponse, type ApiRequest } from "@api/http/api-request";
import { createPasskeyRecoveryRepository } from "@api/modules/identity/server";
import { authenticateApplicationReader } from "@api/shared/infrastructure/authenticated-application-request";

export async function GET(request: ApiRequest) {
  const user = await authenticateApplicationReader(request, "fresh-provider-user");
  if (user instanceof ApiResponse) return user;

  const credential = await createPasskeyRecoveryRepository(getApiRequestContext(request).database).getCredential(
    user.id,
  );
  return ApiResponse.json({ enrolled: credential !== null });
}
