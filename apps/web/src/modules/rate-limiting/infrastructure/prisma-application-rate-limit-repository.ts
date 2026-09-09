import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/shared/infrastructure/prisma-client";
import type {
  ApplicationRateLimitDecision,
  ApplicationRateLimitRepository,
} from "../application/application-rate-limit-repository";
import type { ApplicationRateLimitPolicy, ApplicationRateLimitPolicyId } from "../domain/application-rate-limit-policy";

type ConsumptionRow = { request_count: number; retry_after_seconds: number };

type RateLimitDatabase = Pick<PrismaClient, "$transaction">;

export class PrismaApplicationRateLimitRepository implements ApplicationRateLimitRepository {
  constructor(private readonly database: RateLimitDatabase = prisma) {}

  async consume(
    userId: string,
    operation: ApplicationRateLimitPolicyId,
    policy: ApplicationRateLimitPolicy,
  ): Promise<ApplicationRateLimitDecision> {
    const rows = await this.database.$transaction(async (transaction) => {
      await transaction.$executeRaw`
        DELETE FROM application_rate_limit_windows
        WHERE ctid IN (
          SELECT ctid
          FROM application_rate_limit_windows
          WHERE expires_at < clock_timestamp() - INTERVAL '24 hours'
          ORDER BY expires_at
          LIMIT 1000
        )
      `;
      return transaction.$queryRaw<ConsumptionRow[]>`
        WITH rate_window AS (
          SELECT to_timestamp(
            floor(extract(epoch FROM clock_timestamp()) / ${policy.windowSeconds}) * ${policy.windowSeconds}
          )::timestamp AS started_at
        ), consumed AS (
          INSERT INTO application_rate_limit_windows (
            user_id,
            operation,
            window_started_at,
            expires_at,
            request_count
          )
          SELECT
            ${userId},
            ${operation},
            started_at,
            started_at + make_interval(secs => ${policy.windowSeconds}),
            1
          FROM rate_window
          ON CONFLICT (user_id, operation, window_started_at)
          DO UPDATE SET request_count = LEAST(
            application_rate_limit_windows.request_count + 1,
            ${policy.limit + 1}
          )
          RETURNING request_count, expires_at
        )
        SELECT
          request_count,
          GREATEST(
            1,
            CEIL(extract(epoch FROM (expires_at - clock_timestamp())))
          )::integer AS retry_after_seconds
        FROM consumed
      `;
    });
    const row = rows[0];
    if (!row) throw new Error("Rate-limit backend returned no decision.");
    return { allowed: row.request_count <= policy.limit, retryAfterSeconds: row.retry_after_seconds };
  }
}
