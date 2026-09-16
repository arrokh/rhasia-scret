import { ApiResponse, type ApiRequest } from "@api/http/api-request";
import { getApiRequestContext } from "@api/http/api-context";
import {
  AUTH_RETURN_PATH_COOKIE,
  isSafePwaHandoffId,
  isSafePwaHandoffVerifier,
  isSameOrigin,
  readPasswordlessConfiguration,
  setPasswordlessSessionCookies,
} from "@api/modules/identity/server";

export async function POST(request: ApiRequest): Promise<ApiResponse> {
  const body = await readJson(request);
  if (!body || typeof body.handoffId !== "string")
    return ApiResponse.json({ error: "invalid_request" }, { status: 400, headers: noStoreHeaders() });
  if (!isSameOrigin(request)) return new ApiResponse(null, { status: 403, headers: noStoreHeaders() });

  try {
    const context = getApiRequestContext(request);
    const service = context.passwordlessAuth;
    if (typeof body.refreshToken === "string") {
      if (!isSafePwaHandoffId(body.handoffId))
        return ApiResponse.json({ error: "handoff_failed" }, { status: 401, headers: noStoreHeaders() });
      await service.publishPwaHandoff(body.refreshToken, body.handoffId);
      return ApiResponse.json({ published: true }, { headers: noStoreHeaders() });
    }
    if (typeof body.verifier !== "string" || !isSafePwaHandoffVerifier(body.verifier))
      return ApiResponse.json({ error: "invalid_request" }, { status: 400, headers: noStoreHeaders() });

    const result = await service.redeemPwaHandoff(body.handoffId, body.verifier);
    if (!result) return ApiResponse.json({ pending: true }, { status: 202, headers: noStoreHeaders() });
    const response = ApiResponse.json({ accepted: true, returnPath: result.returnPath }, { headers: noStoreHeaders() });
    await setPasswordlessSessionCookies(
      response.cookies,
      result.session,
      readPasswordlessConfiguration(context.bindings),
    );
    response.cookies.set(AUTH_RETURN_PATH_COOKIE, "", {
      httpOnly: false,
      secure: true,
      sameSite: "lax",
      maxAge: 0,
      path: "/",
    });
    return response;
  } catch {
    return ApiResponse.json({ error: "handoff_failed" }, { status: 401, headers: noStoreHeaders() });
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
