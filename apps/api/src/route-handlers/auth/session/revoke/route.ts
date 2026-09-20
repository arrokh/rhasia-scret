import { ApiResponse, type ApiRequest } from "@api/http/api-request";
import { getApiRequestContext } from "@api/http/api-context";
import { z } from "zod";
import { clearE2eSessionCookie, isSameOriginIfPresent } from "@api/modules/identity/server";

const authorizationHeaderSchema = z.string().regex(/^Bearer [A-Za-z0-9_.-]{1,512}$/);

export async function POST(request: ApiRequest): Promise<ApiResponse> {
  const authorization = request.headers.get("authorization");
  if (authorization && !authorizationHeaderSchema.safeParse(authorization).success)
    return ApiResponse.json({ error: "invalid_request" }, { status: 400, headers: noStoreHeaders() });
  if (authorization && request.headers.has("cookie"))
    return ApiResponse.json({ error: "invalid_request" }, { status: 400, headers: noStoreHeaders() });
  if (request.headers.get("cookie") && !request.headers.has("x-rhasia-proxy-secret"))
    return new ApiResponse(null, { status: 403, headers: noStoreHeaders() });
  if (!isSameOriginIfPresent(request)) return new ApiResponse(null, { status: 403, headers: noStoreHeaders() });
  const context = getApiRequestContext(request);
  const response = new ApiResponse(null, { status: 204, headers: noStoreHeaders() });
  if (context.bindings.NODE_ENV === "development" && context.bindings.E2E_BROWSER_TESTS === "1")
    clearE2eSessionCookie(response.cookies);
  try {
    await context.sessionTerminator.terminateCurrentSession(request, response.cookies);
  } catch {
    // Logout is intentionally idempotent and never discloses session state.
  }
  return response;
}

function noStoreHeaders(): Record<string, string> {
  return { "Cache-Control": "no-store" };
}
