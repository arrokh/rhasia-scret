import { ApiResponse, type ApiRequest } from "@api/http/api-request";
import { getApiRequestContext } from "@api/http/api-context";
import { safeParseJsonBody } from "@api/http/validation";
import { z } from "zod";
import { logApiDependencyFailure } from "@api/shared/infrastructure/logging";
import {
  isSafePwaHandoffId,
  isSafePwaHandoffVerifier,
  isSafeTurnstileToken,
  isClientOriginAllowed,
  requestClientIp,
} from "@api/modules/identity/server";

const magicLinkRequestSchema = z.discriminatedUnion("client", [
  z
    .object({
      client: z.literal("web"),
      email: z.string().trim().min(1).max(254).email(),
      returnPath: z.enum(["/vaults", "/vaults/invitations/redeem"]),
      turnstileToken: z.string().refine(isSafeTurnstileToken),
    })
    .strict(),
  z
    .object({
      client: z.literal("mobile"),
      email: z.string().trim().min(1).max(254).email(),
      returnPath: z.enum(["/vaults", "/vaults/invitations/redeem"]),
    })
    .strict(),
  z
    .object({
      client: z.literal("pwa"),
      email: z.string().trim().min(1).max(254).email(),
      returnPath: z.enum(["/vaults", "/vaults/invitations/redeem"]),
      turnstileToken: z.string().refine(isSafeTurnstileToken),
      handoffId: z.string().refine(isSafePwaHandoffId),
      handoffVerifier: z.string().refine(isSafePwaHandoffVerifier),
    })
    .strict(),
]);

export async function POST(request: ApiRequest): Promise<ApiResponse> {
  const parsed = await safeParseJsonBody(request, magicLinkRequestSchema);
  if (!parsed.success)
    return ApiResponse.json({ error: "invalid_request" }, { status: 400, headers: noStoreHeaders() });
  const body = parsed.data;
  if (!isClientOriginAllowed(request, body.client))
    return new ApiResponse(null, { status: 403, headers: noStoreHeaders() });

  const handoffId = body.client === "pwa" ? body.handoffId : undefined;
  const handoffVerifier = body.client === "pwa" ? body.handoffVerifier : undefined;
  const turnstileResult =
    body.client === "mobile" ? "valid" : await validateTurnstile(request, body.turnstileToken, body.client);
  if (turnstileResult === "invalid")
    return ApiResponse.json({ error: "turnstile_failed" }, { status: 403, headers: noStoreHeaders() });
  if (turnstileResult === "unavailable")
    return ApiResponse.json(
      { error: "turnstile_unavailable" },
      { status: 503, headers: { ...noStoreHeaders(), "Retry-After": "5" } },
    );

  let limit: Readonly<{ allowed: boolean; retryAfterSeconds: number }>;
  const rateLimitStartedAt = Date.now();
  try {
    const context = getApiRequestContext(request);
    const limiter = context.applicationRuntime.anonymousAuthRateLimiter();
    limit = await limiter.check(body.email.trim().toLowerCase(), requestClientIp(request), new Date());
  } catch (error) {
    logApiDependencyFailure(request, "magic_link_request_rate_limit_unavailable", error, {
      dependency: "anonymous_auth_rate_limiter",
      client: body.client,
      durationMs: Date.now() - rateLimitStartedAt,
    });
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

  const deliveryStartedAt = Date.now();
  try {
    await getApiRequestContext(request).identity.passwordlessAuth.requestLink({
      email: body.email,
      client: body.client,
      returnPath: body.returnPath,
      ...(body.client === "pwa" ? { handoffId, handoffVerifier } : {}),
    });
    return ApiResponse.json({ sent: true }, { headers: noStoreHeaders() });
  } catch (error) {
    const challengePersistenceFailed = error instanceof Error && error.name === "PasswordlessChallengePersistenceError";
    const deliveryFailed = error instanceof Error && error.name === "PasswordlessEmailDeliveryError";
    let event = "magic_link_request_failed";
    let dependency: "passwordless_authentication" | "passwordless_challenge_database" | "smtp_email_delivery" =
      "passwordless_authentication";
    if (challengePersistenceFailed) {
      event = "magic_link_request_challenge_persistence_failed";
      dependency = "passwordless_challenge_database";
    } else if (deliveryFailed) {
      event = "magic_link_request_delivery_failed";
      dependency = "smtp_email_delivery";
    }
    logApiDependencyFailure(request, event, error, {
      dependency,
      client: body.client,
      durationMs: Date.now() - deliveryStartedAt,
    });
    return ApiResponse.json({ error: "email_delivery_failed" }, { status: 503, headers: noStoreHeaders() });
  }
}

async function validateTurnstile(
  request: ApiRequest,
  token: string,
  client: "web" | "pwa",
): Promise<"valid" | "invalid" | "unavailable"> {
  const startedAt = Date.now();
  try {
    const diagnostics = await getApiRequestContext(request)
      .applicationRuntime.turnstile()
      .validateWithDiagnostics(token);
    if (diagnostics.result !== "unavailable") return diagnostics.result;
    logApiDependencyFailure(request, "magic_link_request_turnstile_unavailable", new Error("Turnstile unavailable"), {
      dependency: "turnstile",
      client,
      durationMs: Date.now() - startedAt,
      reason: diagnostics.unavailableReason,
      providerStatus: diagnostics.responseStatus,
    });
    return diagnostics.result;
  } catch (error) {
    logApiDependencyFailure(request, "magic_link_request_turnstile_unavailable", error, {
      dependency: "turnstile",
      client,
      durationMs: Date.now() - startedAt,
      reason: "factory_error",
    });
    return "unavailable";
  }
}

function noStoreHeaders(): Record<string, string> {
  return { "Cache-Control": "no-store" };
}
