import { hmacSha256 } from "@api/shared/infrastructure/crypto";
import type { PrismaDatabase } from "@api/shared/infrastructure/prisma-client";

export type AnonymousAuthRateLimitResult = Readonly<{
  allowed: boolean;
  retryAfterSeconds: number;
}>;

type Limit = Readonly<{ operation: string; maximum: number }>;

const WINDOW_SECONDS = 15 * 60;
const LIMITS: readonly Limit[] = [
  { operation: "magic-link-email", maximum: 5 },
  { operation: "magic-link-ip", maximum: 20 },
];

export class PrismaAnonymousAuthRateLimiter {
  public constructor(
    private readonly database: PrismaDatabase,
    private readonly secret: Uint8Array,
  ) {}

  public async check(email: string, clientIp: string | null, now: Date): Promise<AnonymousAuthRateLimitResult> {
    const buckets = [
      { operation: "magic-link-email", value: email },
      ...(clientIp ? [{ operation: "magic-link-ip", value: clientIp }] : []),
    ];
    const results = await Promise.all(buckets.map(({ operation, value }) => this.increment(operation, value, now)));
    const limited = results.find((result) => !result.allowed);
    return limited ?? { allowed: true, retryAfterSeconds: 0 };
  }

  private async increment(operation: string, value: string, now: Date): Promise<AnonymousAuthRateLimitResult> {
    const limit = LIMITS.find((candidate) => candidate.operation === operation);
    if (!limit) throw new Error("Anonymous authentication rate-limit operation is invalid.");
    const windowStartedAt = new Date(Math.floor(now.getTime() / (WINDOW_SECONDS * 1_000)) * WINDOW_SECONDS * 1_000);
    const expiresAt = new Date(windowStartedAt.getTime() + WINDOW_SECONDS * 1_000);
    const bucketHash = Buffer.from(hmacSha256(this.secret, `${operation}:${value}`));
    const record = await this.database.anonymousAuthRateLimitWindow.upsert({
      where: { bucketHash_operation_windowStartedAt: { bucketHash, operation, windowStartedAt } },
      create: { bucketHash, operation, windowStartedAt, expiresAt, requestCount: 1 },
      update: { requestCount: { increment: 1 } },
    });
    return {
      allowed: record.requestCount <= limit.maximum,
      retryAfterSeconds: Math.max(1, Math.ceil((expiresAt.getTime() - now.getTime()) / 1_000)),
    };
  }
}
