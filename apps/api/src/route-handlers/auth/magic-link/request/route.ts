import { ApiResponse, type ApiRequest } from "@api/http/api-request";
import { getApiRequestContext } from "@api/http/api-context";
import { logApiDependencyFailure } from "@api/shared/infrastructure/logging";
import {
  createAnonymousAuthRateLimiter,
  createTurnstileValidator,
  isPasswordlessClient,
  isPasswordlessReturnPath,
  isSafePwaHandoffId,
  isSafePwaHandoffVerifier,
  isSafeTurnstileToken,
  isSameOrigin,
  requestClientIp,
} from "@api/modules/identity/server";

export async function POST(request: ApiRequest): Promise<ApiResponse> {
  const body = await readJson(request);
  if (
    !body ||
    !isPasswordlessClient(body.client) ||
    !isPasswordlessReturnPath(body.returnPath) ||
    typeof body.email !== "string" ||
    (body.client === "pwa" && (typeof body.handoffId !== "string" || typeof body.handoffVerifier !== "string")) ||
    (body.client !== "pwa" && (body.handoffId !== undefined || body.handoffVerifier !== undefined)) ||
    (body.client !== "mobile" &&
      (typeof body.turnstileToken !== "string" || !isSafeTurnstileToken(body.turnstileToken))) ||
    (body.client === "mobile" && body.turnstileToken !== undefined) ||
    (typeof body.handoffId === "string" && !isSafePwaHandoffId(body.handoffId)) ||
    (typeof body.handoffVerifier === "string" && !isSafePwaHandoffVerifier(body.handoffVerifier))
  )
    return ApiResponse.json({ error: "invalid_request" }, { status: 400, headers: noStoreHeaders() });
  if ((body.client === "web" || body.client === "pwa") && !isSameOrigin(request))
    return new ApiResponse(null, { status: 403, headers: noStoreHeaders() });
  if (body.client === "mobile" && request.headers.get("origin") && !isSameOrigin(request))
    return new ApiResponse(null, { status: 403, headers: noStoreHeaders() });

  const handoffId = typeof body.handoffId === "string" ? body.handoffId : undefined;
  const handoffVerifier = typeof body.handoffVerifier === "string" ? body.handoffVerifier : undefined;
  if (body.client !== "mobile") {
    const turnstileResult = await validateTurnstile(request, body.turnstileToken);
    if (turnstileResult === "invalid")
      return ApiResponse.json({ error: "turnstile_failed" }, { status: 403, headers: noStoreHeaders() });
    if (turnstileResult === "unavailable")
      return ApiResponse.json(
        { error: "turnstile_unavailable" },
        { status: 503, headers: { ...noStoreHeaders(), "Retry-After": "5" } },
      );
  }

  let limit: Readonly<{ allowed: boolean; retryAfterSeconds: number }>;
  try {
    const context = getApiRequestContext(request);
    const limiter = createAnonymousAuthRateLimiter(context.database, context.bindings);
    limit = await limiter.check(body.email.trim().toLowerCase(), requestClientIp(request), new Date());
  } catch (error) {
    logApiDependencyFailure(request, "magic_link_request_rate_limit_unavailable", error);
    return ApiResponse.json(
      { error: "rate_limit_unavailable" },
      { status: 503, headers: { ...noStoreHeaders(), "Retry-After": "5" } },
    );
  }
  if (!limit.allowed)
    return ApiResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { ...noStoreHeaders(), "Retry-After": String(limit.retryAfterSeconds) } },
    );

  try {
    await getApiRequestContext(request).passwordlessAuth.requestLink({
      email: body.email,
      client: body.client,
      returnPath: body.returnPath,
      ...(body.client === "pwa" ? { handoffId, handoffVerifier } : {}),
    });
    return ApiResponse.json({ sent: true }, { headers: noStoreHeaders() });
  } catch (error) {
    logApiDependencyFailure(request, "magic_link_request_delivery_failed", error);
    return ApiResponse.json({ error: "email_delivery_failed" }, { status: 503, headers: noStoreHeaders() });
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

async function validateTurnstile(request: ApiRequest, token: unknown): Promise<"valid" | "invalid" | "unavailable"> {
  if (typeof token !== "string") return "invalid";
  try {
    return await createTurnstileValidator(getApiRequestContext(request).bindings).validate(token);
  } catch (error) {
    logApiDependencyFailure(request, "magic_link_request_turnstile_unavailable", error);
    return "unavailable";
  }
}

function noStoreHeaders(): Record<string, string> {
  return { "Cache-Control": "no-store" };
}
