import { describe, expect, it, vi } from "vitest";
import type { ApplicationRateLimitRepository } from "@/modules/rate-limiting/application/application-rate-limit-repository";
import { createApplicationRateLimitChecker } from "@/modules/rate-limiting/application/check-application-rate-limit";
import { BoundedRateLimitMetrics } from "@/modules/rate-limiting/infrastructure/bounded-rate-limit-metrics";

describe("application rate-limit checker", () => {
  it("allows requests and forwards only opaque user and operation identifiers", async () => {
    const consume = vi.fn().mockResolvedValue({ allowed: true, retryAfterSeconds: 60 });
    const record = vi.fn();
    const check = createApplicationRateLimitChecker({ consume }, { record });

    await expect(check("account_mutation", "user_opaque_1")).resolves.toEqual({ status: "allowed" });
    expect(consume).toHaveBeenCalledWith("user_opaque_1", "account_mutation", { limit: 120, windowSeconds: 60 });
    expect(record).toHaveBeenCalledWith("account_mutation", "allowed");
  });

  it("returns a bounded retry signal after exhaustion", async () => {
    const repository: ApplicationRateLimitRepository = { consume: vi.fn().mockResolvedValue({ allowed: false, retryAfterSeconds: 12.2 }) };
    const check = createApplicationRateLimitChecker(repository, { record: vi.fn() });

    await expect(check("membership_mutation", "user_1")).resolves.toEqual({ status: "limited", retryAfterSeconds: 13 });
  });

  it("fails closed with a short retry signal when the backend is unavailable", async () => {
    const repository: ApplicationRateLimitRepository = { consume: vi.fn().mockRejectedValue(new Error("database unavailable")) };
    const record = vi.fn();
    const check = createApplicationRateLimitChecker(repository, { record });

    await expect(check("vault_mutation", "user_1")).resolves.toEqual({ status: "unavailable", retryAfterSeconds: 5 });
    expect(record).toHaveBeenCalledWith("vault_mutation", "unavailable");
  });

  it("never changes admission when operational metric reporting fails", async () => {
    const repository: ApplicationRateLimitRepository = { consume: vi.fn().mockResolvedValue({ allowed: true, retryAfterSeconds: 1 }) };
    const check = createApplicationRateLimitChecker(repository, { record: () => { throw new Error("metrics unavailable"); } });

    await expect(check("audit_event", "user_1")).resolves.toEqual({ status: "allowed" });
  });
});

describe("bounded rate-limit metrics", () => {
  it("emits only aggregate operation outcomes in a bounded time window", () => {
    let now = Date.parse("2026-07-26T00:00:00.000Z");
    const reports: string[] = [];
    const metrics = new BoundedRateLimitMetrics(() => now, (line) => reports.push(line));
    metrics.record("account_mutation", "allowed");
    metrics.record("account_mutation", "limited");
    now += 60_000;
    metrics.record("vault_mutation", "allowed");

    expect(reports).toHaveLength(1);
    expect(JSON.parse(reports[0] ?? "{}")).toEqual({
      event: "application_rate_limit_metrics",
      windowStartedAt: "2026-07-26T00:00:00.000Z",
      windowSeconds: 60,
      counts: { "account_mutation:allowed": 1, "account_mutation:limited": 1 }
    });
    expect(reports[0]).not.toMatch(/user|email|payload|credential|key/i);
  });
});
