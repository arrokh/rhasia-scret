import { ApiResponse, type ApiRequest } from "@api/http/api-request";
import { getApiRequestContext } from "@api/http/api-context";
import { safeParseJsonBody } from "@api/http/validation";
import { z } from "zod";
import { clearPasswordlessSessionCookies, isClientOriginAllowed } from "@api/modules/identity/server";

const refreshSessionSchema = z
  .object({
    client: z.enum(["mobile", "web"]),
    refreshToken: z.string().min(1).max(257).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.client === "web" && value.refreshToken !== undefined)
      context.addIssue({
        code: "custom",
        path: ["refreshToken"],
        message: "refreshToken is not valid for web sessions",
      });
  });

export async function POST(request: ApiRequest): Promise<ApiResponse> {
  const parsed = await safeParseJsonBody(request, refreshSessionSchema);
  if (!parsed.success)
    return ApiResponse.json({ error: "invalid_request" }, { status: 400, headers: noStoreHeaders() });
  const body = parsed.data;
  const client = body.client;
  if (!isClientOriginAllowed(request, client)) return new ApiResponse(null, { status: 403, headers: noStoreHeaders() });
  if (client === "web") {
    if (request.headers.has("authorization"))
      return ApiResponse.json({ error: "invalid_request" }, { status: 400, headers: noStoreHeaders() });
    return verifyBrowserSession(request);
  }
  if (request.headers.has("cookie") || request.headers.has("authorization"))
    return ApiResponse.json({ error: "invalid_request" }, { status: 400, headers: noStoreHeaders() });
  if (body.refreshToken === undefined)
    return ApiResponse.json({ error: "session_expired" }, { status: 401, headers: noStoreHeaders() });

  const refreshToken = body.refreshToken;

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
