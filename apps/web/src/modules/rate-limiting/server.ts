import { createApplicationRateLimitChecker } from "./application/check-application-rate-limit";
import { BoundedRateLimitMetrics } from "./infrastructure/bounded-rate-limit-metrics";
import { PrismaApplicationRateLimitRepository } from "./infrastructure/prisma-application-rate-limit-repository";

export type { ApplicationRateLimitOutcome } from "./application/check-application-rate-limit";
export type { ApplicationRateLimitPolicyId } from "./domain/application-rate-limit-policy";

export const checkApplicationRateLimit = createApplicationRateLimitChecker(
  new PrismaApplicationRateLimitRepository(),
  new BoundedRateLimitMetrics()
);
