import type { ApplicationRateLimitPolicy, ApplicationRateLimitPolicyId } from "../domain/application-rate-limit-policy";

export type ApplicationRateLimitDecision = Readonly<{
  allowed: boolean;
  retryAfterSeconds: number;
}>;

export interface ApplicationRateLimitRepository {
  consume(
    userId: string,
    operation: ApplicationRateLimitPolicyId,
    policy: ApplicationRateLimitPolicy,
  ): Promise<ApplicationRateLimitDecision>;
}
