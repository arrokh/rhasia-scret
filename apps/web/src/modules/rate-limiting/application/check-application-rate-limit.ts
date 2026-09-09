import {
  APPLICATION_RATE_LIMIT_POLICIES,
  type ApplicationRateLimitPolicyId,
} from "../domain/application-rate-limit-policy";
import type { ApplicationRateLimitRepository } from "./application-rate-limit-repository";

export type ApplicationRateLimitOutcome =
  | Readonly<{ status: "allowed" }>
  | Readonly<{ status: "limited"; retryAfterSeconds: number }>
  | Readonly<{ status: "unavailable"; retryAfterSeconds: number }>;

export interface ApplicationRateLimitMetrics {
  record(operation: ApplicationRateLimitPolicyId, outcome: ApplicationRateLimitOutcome["status"]): void;
}

export function createApplicationRateLimitChecker(
  repository: ApplicationRateLimitRepository,
  metrics: ApplicationRateLimitMetrics,
) {
  return async function checkApplicationRateLimit(
    operation: ApplicationRateLimitPolicyId,
    userId: string,
  ): Promise<ApplicationRateLimitOutcome> {
    try {
      const decision = await repository.consume(userId, operation, APPLICATION_RATE_LIMIT_POLICIES[operation]);
      const outcome: ApplicationRateLimitOutcome = decision.allowed
        ? { status: "allowed" }
        : { status: "limited", retryAfterSeconds: safeRetryAfter(decision.retryAfterSeconds) };
      safeRecord(metrics, operation, outcome.status);
      return outcome;
    } catch {
      const outcome: ApplicationRateLimitOutcome = { status: "unavailable", retryAfterSeconds: 5 };
      safeRecord(metrics, operation, outcome.status);
      return outcome;
    }
  };
}

function safeRecord(
  metrics: ApplicationRateLimitMetrics,
  operation: ApplicationRateLimitPolicyId,
  outcome: ApplicationRateLimitOutcome["status"],
): void {
  try {
    metrics.record(operation, outcome);
  } catch {
    /* Metrics must never change request admission. */
  }
}

function safeRetryAfter(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(Math.ceil(value), 86_400));
}
