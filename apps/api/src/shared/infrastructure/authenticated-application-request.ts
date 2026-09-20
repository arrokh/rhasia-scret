import { ApiResponse } from "@api/http/api-request";
import { getApiRequestContext } from "@api/http/api-context";
import {
  createAuthenticatedApplicationExecutor,
  type AuthenticatedApplicationRequest,
  type AuthenticatedApplicationResult as ApplicationAuthenticationResult,
} from "@api/modules/server-composition/application";
import type { ApplicationUser, SessionAssurance } from "@api/modules/identity";
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
  input: AuthenticatedApplicationRequest,
): Promise<AuthenticatedApplicationResult> {
  const context = getApiRequestContext(request);
  const result = await createAuthenticatedApplicationExecutor({
    verifySession: (assurance) => context.identity.sessionVerifier.verify(request, assurance),
    provisionApplicationUser: (principal) => context.identity.applicationUsers.provision(principal),
    checkApplicationRateLimit: (operation, userId) =>
      context.applicationRuntime.applicationRateLimitChecker()(operation, userId),
  })(input);
  return mapAuthenticationResult(result);
}

function mapAuthenticationResult(result: ApplicationAuthenticationResult): AuthenticatedApplicationResult {
  switch (result.status) {
    case "allowed":
      return result.user;
    case "unauthenticated":
      return ApiResponse.json({ error: "unauthenticated" }, { status: 401 });
    case "inactive_user":
      return ApiResponse.json({ error: "inactive_user" }, { status: 403 });
    case "rate_limited":
      return ApiResponse.json(
        { error: "rate_limited" },
        { status: 429, headers: retryAfterHeaders(result.retryAfterSeconds) },
      );
    case "rate_limit_unavailable":
      return ApiResponse.json(
        { error: "rate_limit_unavailable" },
        { status: 503, headers: retryAfterHeaders(result.retryAfterSeconds) },
      );
  }
}

function retryAfterHeaders(retryAfterSeconds: number): Headers {
  const headers = new Headers({ "cache-control": "no-store" });
  if (retryAfterSeconds > 0) headers.set("retry-after", String(retryAfterSeconds));
  return headers;
}
