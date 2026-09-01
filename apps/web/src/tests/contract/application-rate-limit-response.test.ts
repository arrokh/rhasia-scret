import { describe, expect, it } from "vitest";
import { applicationRateLimitResponse } from "@/modules/rate-limiting";

describe("application mutation rate-limit response contract", () => {
  it("returns a consistent safe 429 response with Retry-After", async () => {
    const response = applicationRateLimitResponse({ status: "limited", retryAfterSeconds: 17 });

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({ error: "rate_limited" });
    expect(response.headers.get("retry-after")).toBe("17");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("fails closed with a distinguishable 503 when the backend is unavailable", async () => {
    const response = applicationRateLimitResponse({ status: "unavailable", retryAfterSeconds: 5 });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "rate_limit_unavailable" });
    expect(response.headers.get("retry-after")).toBe("5");
  });
});
