import type { ApplicationUser, SessionAssurance, VerifiedPrincipal } from "@api/modules/identity";
import type { ApplicationRateLimitOutcome, ApplicationRateLimitPolicyId } from "@api/modules/rate-limiting";

export type AuthenticatedApplicationRequest =
  | Readonly<{ assurance: SessionAssurance; access: "reader" }>
  | Readonly<{ assurance: SessionAssurance; access: "mutation"; operation: ApplicationRateLimitPolicyId }>;

export type AuthenticatedApplicationResult =
  | Readonly<{ status: "allowed"; user: ApplicationUser }>
  | Readonly<{ status: "unauthenticated" }>
  | Readonly<{ status: "inactive_user" }>
  | Readonly<{ status: "rate_limited"; retryAfterSeconds: number }>
  | Readonly<{ status: "rate_limit_unavailable"; retryAfterSeconds: number }>;

export type AuthenticatedApplicationDependencies = {
  verifySession(assurance: SessionAssurance): Promise<VerifiedPrincipal | null>;
  provisionApplicationUser(principal: VerifiedPrincipal): Promise<ApplicationUser>;
  checkApplicationRateLimit(
    operation: ApplicationRateLimitPolicyId,
    userId: string,
  ): Promise<ApplicationRateLimitOutcome>;
};

export function createAuthenticatedApplicationExecutor(dependencies: AuthenticatedApplicationDependencies) {
  return async function executeAuthenticatedApplicationRequest(
    request: AuthenticatedApplicationRequest,
  ): Promise<AuthenticatedApplicationResult> {
    const principal = await dependencies.verifySession(request.assurance);
    if (!principal) return { status: "unauthenticated" };

    let user: ApplicationUser;
    try {
      user = await dependencies.provisionApplicationUser(principal);
    } catch (error) {
      // Keep this boundary name-based: importing the identity public barrel would pull client presentation code into APIs.
      if (error instanceof Error && error.name === "ApplicationUserCredentialInvalidatedError")
        return { status: "unauthenticated" };
      throw error;
    }
    if (!user.canAccessApplication()) return { status: "inactive_user" };
    if (request.access === "reader") return { status: "allowed", user };

    const rateLimit = await dependencies.checkApplicationRateLimit(request.operation, user.id);
    if (rateLimit.status === "allowed") return { status: "allowed", user };
    return {
      status: rateLimit.status === "limited" ? "rate_limited" : "rate_limit_unavailable",
      retryAfterSeconds: rateLimit.retryAfterSeconds,
    };
  };
}
