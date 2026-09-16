import { createApplicationRateLimitChecker } from "./application/check-application-rate-limit";
import { BoundedRateLimitMetrics } from "./infrastructure/bounded-rate-limit-metrics";
import { PrismaApplicationRateLimitRepository } from "./infrastructure/prisma-application-rate-limit-repository";
import type { PrismaDatabase } from "@api/shared/infrastructure/prisma-client";

export type { ApplicationRateLimitOutcome } from "./application/check-application-rate-limit";
export type { ApplicationRateLimitPolicyId } from "./domain/application-rate-limit-policy";

export function createApplicationRateLimitCheckerForDatabase(database: PrismaDatabase) {
  return createApplicationRateLimitChecker(
    new PrismaApplicationRateLimitRepository(database),
    new BoundedRateLimitMetrics(),
  );
}
