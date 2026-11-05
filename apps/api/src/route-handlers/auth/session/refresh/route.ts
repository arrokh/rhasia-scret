import { ApiResponse, type ApiRequest } from "@api/http/api-request";
import { getApiRequestContext } from "@api/http/api-context";
import { safeParseJsonBody } from "@api/http/validation";
import { z } from "zod";
import { clearPasswordlessSessionCookies, isClientOriginAllowed } from "@api/modules/identity/server";
import { PASSWORDLESS_ISSUER } from "@api/modules/identity/application/passwordless-authentication";
import { renewPasswordlessBrowserAssertionCookie } from "@api/modules/identity/infrastructure/passwordless-session";
import { readApiPasswordlessConfiguration } from "@api/modules/identity/infrastructure/passwordless-service";

const refreshSessionSchema = z.object({ client: z.literal("web") }).strict();

export async function POST(request: ApiRequest): Promise<ApiResponse> {
  const parsed = await safeParseJsonBody(request, refreshSessionSchema);
  if (!parsed.success)
    return ApiResponse.json({ error: "invalid_request" }, { status: 400, headers: noStoreHeaders() });
  if (!isClientOriginAllowed(request)) return new ApiResponse(null, { status: 403, headers: noStoreHeaders() });
  if (request.headers.has("authorization"))
    return ApiResponse.json({ error: "invalid_request" }, { status: 400, headers: noStoreHeaders() });

  return verifyBrowserSession(request);
}

async function verifyBrowserSession(request: ApiRequest): Promise<ApiResponse> {
  const session = await getApiRequestContext(request).identity.sessionVerifier.verify(request, "active-session");
  if (session) {
    const response = ApiResponse.json({ refreshed: true }, { headers: noStoreHeaders() });
    if (session.issuer === PASSWORDLESS_ISSUER && session.sessionId && session.sessionExpiresAt) {
      const { bindings } = getApiRequestContext(request);
      await renewPasswordlessBrowserAssertionCookie(
        response.cookies,
        readApiPasswordlessConfiguration(bindings),
        session.sessionId,
        session.sessionExpiresAt,
      );
    }
    return response;
  }
  const response = ApiResponse.json({ error: "session_expired" }, { status: 401, headers: noStoreHeaders() });
  clearPasswordlessSessionCookies(response.cookies);
  return response;
}

function noStoreHeaders(): Record<string, string> {
  return { "Cache-Control": "no-store" };
}
