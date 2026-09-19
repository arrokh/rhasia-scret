import { ApiResponse } from "@api/http/api-request";
import { getApiRequestContext } from "@api/http/api-context";
import type { ApplicationUser } from "@api/modules/identity";
import type { SessionAssurance } from "@api/modules/identity";
import type { ApplicationRateLimitPolicyId } from "@api/modules/rate-limiting";

export type AuthenticatedApplicationResult = ApplicationUser | ApiResponse;

export async function authenticateApplicationReader(
  request: Request,
  assurance: SessionAssurance,
): Promise<AuthenticatedApplicationResult> {
  return authenticate(request, { access: "reader", assurance });
}

export async function authenticateApplicationMutation(
  request: Request,
  operation: ApplicationRateLimitPolicyId,
  assurance: SessionAssurance,
): Promise<AuthenticatedApplicationResult> {
  return authenticate(request, { access: "mutation", assurance, operation });
}

async function authenticate(
  request: Request,
  input: Readonly<{
    access: "reader" | "mutation";
    assurance: SessionAssurance;
    operation?: ApplicationRateLimitPolicyId;
  }>,
): Promise<AuthenticatedApplicationResult> {
  const context = getApiRequestContext(request);
  const principal = await context.sessionVerifier.verify(request, input.assurance);
  if (!principal) return ApiResponse.json({ error: "unauthenticated" }, { status: 401 });

  let user: ApplicationUser;
  try {
    user = await context.applicationUsers.provision(principal);
  } catch (error) {
    if (error instanceof Error && error.name === "ApplicationUserCredentialInvalidatedError")
      return ApiResponse.json({ error: "unauthenticated" }, { status: 401 });
    throw error;
  }
  if (!user.canAccessApplication()) return ApiResponse.json({ error: "inactive_user" }, { status: 403 });
  if (input.access === "reader") return user;
  if (!input.operation) throw new Error("Mutation operation is required.");
  const rateLimit = await context.checkApplicationRateLimit(input.operation, user.id);
  if (rateLimit.status === "allowed") return user;
  const status = rateLimit.status === "limited" ? 429 : 503;
  const headers = new Headers({ "cache-control": "no-store" });
  if (rateLimit.retryAfterSeconds > 0) headers.set("retry-after", String(rateLimit.retryAfterSeconds));
  return ApiResponse.json(
    { error: rateLimit.status === "limited" ? "rate_limited" : "rate_limit_unavailable" },
    { status, headers },
  );
}
