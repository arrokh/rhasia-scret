import { NextResponse } from "next/server";
import { createApplicationRateLimitChecker } from "../application/check-application-rate-limit";
import type { ApplicationRateLimitPolicyId } from "../domain/application-rate-limit-policy";
import { checkApplicationRateLimit } from "../server";
import { applicationRateLimitResponse } from "./application-rate-limit-response";

type RateLimitChecker = ReturnType<typeof createApplicationRateLimitChecker>;

export function createRateLimitApplicationUser(checkApplicationRateLimit: RateLimitChecker) {
  return async function rateLimitApplicationUser(operation: ApplicationRateLimitPolicyId, userId: string): Promise<NextResponse | null> {
    const outcome = await checkApplicationRateLimit(operation, userId);
    if (outcome.status === "allowed") return null;
    return applicationRateLimitResponse(outcome);
  };
}

export const rateLimitApplicationUser = createRateLimitApplicationUser(checkApplicationRateLimit);
