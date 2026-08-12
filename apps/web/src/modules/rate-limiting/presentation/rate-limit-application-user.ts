import { NextResponse } from "next/server";
import { createApplicationRateLimitChecker } from "../application/check-application-rate-limit";
import type { ApplicationRateLimitPolicyId } from "../domain/application-rate-limit-policy";
import { BoundedRateLimitMetrics } from "../infrastructure/bounded-rate-limit-metrics";
import { PrismaApplicationRateLimitRepository } from "../infrastructure/prisma-application-rate-limit-repository";

type RateLimitChecker = ReturnType<typeof createApplicationRateLimitChecker>;

export function createRateLimitApplicationUser(checkApplicationRateLimit: RateLimitChecker) {
  return async function rateLimitApplicationUser(operation: ApplicationRateLimitPolicyId, userId: string): Promise<NextResponse | null> {
    const outcome = await checkApplicationRateLimit(operation, userId);
    if (outcome.status === "allowed") return null;
    return NextResponse.json(
      { error: outcome.status === "limited" ? "rate_limited" : "rate_limit_unavailable" },
      {
        status: outcome.status === "limited" ? 429 : 503,
        headers: {
          "cache-control": "no-store",
          "retry-after": String(outcome.retryAfterSeconds)
        }
      }
    );
  };
}

export const rateLimitApplicationUser = createRateLimitApplicationUser(createApplicationRateLimitChecker(
  new PrismaApplicationRateLimitRepository(),
  new BoundedRateLimitMetrics()
));
