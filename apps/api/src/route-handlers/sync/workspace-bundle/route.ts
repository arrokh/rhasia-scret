import { getApiRequestContext } from "@api/http/api-context";
import { ApiResponse } from "@api/http/api-request";
import { type AuthorizedWorkspaceReader } from "@api/modules/sync/server";
import { authenticateApplicationReader } from "@api/shared/infrastructure/authenticated-application-request";

export function createAuthorizedWorkspaceHandler({
  authenticate,
  workspace,
}: {
  authenticate: typeof authenticateApplicationReader;
  workspace: AuthorizedWorkspaceReader;
}) {
  return async function GET(request: Request) {
    const user = await authenticate(request, "fresh-provider-user");
    if (user instanceof ApiResponse) return user;
    const response = await workspace.readAuthorizedWorkspaceResponse(user.id);
    if (!response) return ApiResponse.json({ error: "not_initialized" }, { status: 404 });
    const headers = { "cache-control": "no-store, private", "x-synchronized-at": response.synchronizedAt };
    return ApiResponse.json(response, { headers });
  };
}

export async function GET(request: Request) {
  return createAuthorizedWorkspaceHandler({
    authenticate: authenticateApplicationReader,
    workspace: getApiRequestContext(request).applicationRuntime.authorizedWorkspace(),
  })(request);
}
