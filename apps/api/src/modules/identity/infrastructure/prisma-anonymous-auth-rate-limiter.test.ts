import { describe, expect, it, vi } from "vitest";
import type { PrismaDatabase } from "@api/shared/infrastructure/prisma-client";
import { PrismaAnonymousAuthRateLimiter } from "./prisma-anonymous-auth-rate-limiter";

describe("Prisma anonymous authentication rate limiter", () => {
  it("uses a shared fallback bucket when no trusted client IP is available", async () => {
    const upsert = vi.fn().mockImplementation(({ create }: { create: Record<string, unknown> }) => ({
      ...create,
      requestCount: 1,
    }));
    const limiter = new PrismaAnonymousAuthRateLimiter(
      { anonymousAuthRateLimitWindow: { upsert } } as unknown as PrismaDatabase,
      new Uint8Array([1, 2, 3]),
    );

    await limiter.check("person@example.test", null, new Date("2026-09-20T00:00:00.000Z"));

    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert.mock.calls.map(([input]) => input.create.operation)).toEqual([
      "magic-link-email",
      "magic-link-unattributed",
    ]);
  });
});
