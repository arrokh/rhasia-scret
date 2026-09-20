import { ApiResponse, type ApiRequest } from "@api/http/api-request";
import { getApiRequestContext } from "@api/http/api-context";
import { safeParseJsonBody } from "@api/http/validation";
import { z } from "zod";
import {
  AUTH_RETURN_PATH_COOKIE,
  isSafePwaHandoffId,
  isSafePwaHandoffVerifier,
  isSameOrigin,
  readPasswordlessConfiguration,
  setPasswordlessSessionCookies,
} from "@api/modules/identity/server";

const pwaSessionSchema = z.union([
  z
    .object({
      handoffId: z.string().refine(isSafePwaHandoffId),
      refreshToken: z.string().min(1).max(257),
    })
    .strict(),
  z
    .object({
      handoffId: z.string().refine(isSafePwaHandoffId),
      verifier: z.string().refine(isSafePwaHandoffVerifier),
    })
    .strict(),
]);

export async function POST(request: ApiRequest): Promise<ApiResponse> {
  const parsed = await safeParseJsonBody(request, pwaSessionSchema);
  if (!parsed.success)
    return ApiResponse.json({ error: "invalid_request" }, { status: 400, headers: noStoreHeaders() });
  const body = parsed.data;
  if (!isSameOrigin(request)) return new ApiResponse(null, { status: 403, headers: noStoreHeaders() });

  try {
    const context = getApiRequestContext(request);
    const service = context.identity.passwordlessAuth;
    if ("refreshToken" in body) {
      await service.publishPwaHandoff(body.refreshToken, body.handoffId);
      return ApiResponse.json({ published: true }, { headers: noStoreHeaders() });
    }

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

function noStoreHeaders(): Record<string, string> {
  return { "Cache-Control": "no-store" };
}
