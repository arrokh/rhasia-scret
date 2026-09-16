import { ApiResponse, type ApiRequest } from "@api/http/api-request";
import { getApiRequestContext } from "@api/http/api-context";
import { clearPasswordlessSessionCookies, isSameOrigin } from "@api/modules/identity/server";

export async function POST(request: ApiRequest): Promise<ApiResponse> {
  const body = await readJson(request);
  const client = body?.client;
  if (client !== "mobile" && client !== "web")
    return ApiResponse.json({ error: "invalid_request" }, { status: 400, headers: noStoreHeaders() });
  if (
    (client === "web" && !isSameOrigin(request)) ||
    (client === "mobile" && request.headers.get("origin") && !isSameOrigin(request))
  )
    return new ApiResponse(null, { status: 403, headers: noStoreHeaders() });
  const hasRefreshTokenField = !!body && Object.hasOwn(body, "refreshToken");
  if (client === "web") {
    if (hasRefreshTokenField || request.headers.has("authorization"))
      return ApiResponse.json({ error: "invalid_request" }, { status: 400, headers: noStoreHeaders() });
    return verifyBrowserSession(request);
  }
  if (request.headers.has("cookie") || request.headers.has("authorization"))
    return ApiResponse.json({ error: "invalid_request" }, { status: 400, headers: noStoreHeaders() });
  if (typeof body?.refreshToken !== "string")
    return ApiResponse.json({ error: "session_expired" }, { status: 401, headers: noStoreHeaders() });

  const refreshToken = body.refreshToken;
  if (!refreshToken) return ApiResponse.json({ error: "session_expired" }, { status: 401, headers: noStoreHeaders() });

  try {
    const session = await getApiRequestContext(request).passwordlessAuth.refresh(refreshToken);
    if (!session) return ApiResponse.json({ error: "session_expired" }, { status: 401, headers: noStoreHeaders() });
    return ApiResponse.json(
      {
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        accessExpiresAt: session.accessExpiresAt.toISOString(),
        refreshExpiresAt: session.refreshExpiresAt.toISOString(),
        email: session.principal.email,
      },
      { headers: noStoreHeaders() },
    );
  } catch {
    return ApiResponse.json({ error: "session_unavailable" }, { status: 401, headers: noStoreHeaders() });
  }
}

async function readJson(request: ApiRequest): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await request.json();
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function verifyBrowserSession(request: ApiRequest): Promise<ApiResponse> {
  const session = await getApiRequestContext(request).sessionVerifier.verify(request, "active-session");
  if (session) return ApiResponse.json({ refreshed: true }, { headers: noStoreHeaders() });
  const response = ApiResponse.json({ error: "session_expired" }, { status: 401, headers: noStoreHeaders() });
  clearPasswordlessSessionCookies(response.cookies);
  return response;
}

function noStoreHeaders(): Record<string, string> {
  return { "Cache-Control": "no-store" };
}
