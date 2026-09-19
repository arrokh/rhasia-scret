import { ApiResponse, type ApiRequest } from "@api/http/api-request";
import { getApiRequestContext } from "@api/http/api-context";
import {
  AUTH_RETURN_PATH_COOKIE,
  isPasswordlessClient,
  isSameOrigin,
  readPasswordlessConfiguration,
  setPasswordlessSessionCookies,
} from "@api/modules/identity/server";

export async function POST(request: ApiRequest): Promise<ApiResponse> {
  const body = await readJson(request);
  if (!body || typeof body.token !== "string" || !isPasswordlessClient(body.client))
    return ApiResponse.json({ error: "invalid_request" }, { status: 400, headers: noStoreHeaders() });
  if ((body.client === "web" || body.client === "pwa") && !isSameOrigin(request))
    return new ApiResponse(null, { status: 403, headers: noStoreHeaders() });
  if (body.client === "mobile" && request.headers.get("origin") && !isSameOrigin(request))
    return new ApiResponse(null, { status: 403, headers: noStoreHeaders() });

  try {
    const context = getApiRequestContext(request);
    const configuration = readPasswordlessConfiguration(context.bindings);
    const service = context.passwordlessAuth;
    const result = await service.redeem(body.token, body.client);
    if (!result) return ApiResponse.json({ error: "link_expired" }, { status: 400, headers: noStoreHeaders() });
    const response = ApiResponse.json(
      body.client === "mobile"
        ? {
            accessToken: result.session.accessToken,
            refreshToken: result.session.refreshToken,
            accessExpiresAt: result.session.accessExpiresAt.toISOString(),
            refreshExpiresAt: result.session.refreshExpiresAt.toISOString(),
            email: result.session.principal.email,
            returnPath: result.returnPath,
          }
        : body.client === "pwa"
          ? { refreshToken: result.session.refreshToken, returnPath: result.returnPath }
          : { returnPath: result.returnPath },
      { headers: noStoreHeaders() },
    );
    if (body.client === "web") {
      await setPasswordlessSessionCookies(response.cookies, result.session, configuration);
      response.cookies.set(AUTH_RETURN_PATH_COOKIE, "", {
        httpOnly: false,
        secure: true,
        sameSite: "lax",
        maxAge: 0,
        path: "/",
      });
    }
    return response;
  } catch {
    return ApiResponse.json({ error: "redemption_failed" }, { status: 400, headers: noStoreHeaders() });
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

function noStoreHeaders(): Record<string, string> {
  return { "Cache-Control": "no-store" };
}
