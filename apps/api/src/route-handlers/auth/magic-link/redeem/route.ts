import { ApiResponse, type ApiRequest } from "@api/http/api-request";
import { getApiRequestContext } from "@api/http/api-context";
import { safeParseJsonBody } from "@api/http/validation";
import { z } from "zod";
import {
  AUTH_RETURN_PATH_COOKIE,
  isClientOriginAllowed,
  readPasswordlessConfiguration,
  setPasswordlessSessionCookies,
} from "@api/modules/identity/server";

const magicLinkRedeemSchema = z
  .object({
    token: z.string().min(1).max(128),
    client: z.enum(["web", "mobile", "pwa"]),
  })
  .strict();

export async function POST(request: ApiRequest): Promise<ApiResponse> {
  const parsed = await safeParseJsonBody(request, magicLinkRedeemSchema);
  if (!parsed.success)
    return ApiResponse.json({ error: "invalid_request" }, { status: 400, headers: noStoreHeaders() });
  const body = parsed.data;
  if (!isClientOriginAllowed(request, body.client))
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

function noStoreHeaders(): Record<string, string> {
  return { "Cache-Control": "no-store" };
}
