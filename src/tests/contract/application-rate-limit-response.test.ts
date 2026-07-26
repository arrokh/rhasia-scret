import { describe, expect, it, vi } from "vitest";
import { createRateLimitApplicationUser } from "@/modules/rate-limiting/presentation/rate-limit-application-user";

describe("application mutation rate-limit response contract", () => {
  it("returns a consistent safe 429 response with Retry-After", async () => {
    const guard = createRateLimitApplicationUser(vi.fn().mockResolvedValue({ status: "limited", retryAfterSeconds: 17 }));
    const response = await guard("account_mutation", "user_1");

    expect(response?.status).toBe(429);
    await expect(response?.json()).resolves.toEqual({ error: "rate_limited" });
    expect(response?.headers.get("retry-after")).toBe("17");
    expect(response?.headers.get("cache-control")).toBe("no-store");
  });

  it("fails closed with a distinguishable 503 when the backend is unavailable", async () => {
    const guard = createRateLimitApplicationUser(vi.fn().mockResolvedValue({ status: "unavailable", retryAfterSeconds: 5 }));
    const response = await guard("key_material_mutation", "user_1");

    expect(response?.status).toBe(503);
    await expect(response?.json()).resolves.toEqual({ error: "rate_limit_unavailable" });
    expect(response?.headers.get("retry-after")).toBe("5");
  });

  it("returns no response override for an allowed request", async () => {
    const guard = createRateLimitApplicationUser(vi.fn().mockResolvedValue({ status: "allowed" }));
    await expect(guard("vault_mutation", "user_2")).resolves.toBeNull();
  });
});
