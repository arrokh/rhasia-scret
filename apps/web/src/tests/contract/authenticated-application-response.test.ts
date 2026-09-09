import { describe, expect, it } from "vitest";
import { authenticatedApplicationFailureResponse } from "@/shared/infrastructure/authenticated-application-response";
import type { AuthenticatedApplicationResult } from "@/modules/server-composition";

describe("authenticated application HTTP response mapping", () => {
  it.each([
    [{ status: "unauthenticated" } as const, 401, null],
    [{ status: "application_user_unavailable" } as const, 403, null],
    [{ status: "inactive_user" } as const, 403, null],
    [{ status: "rate_limited", retryAfterSeconds: 17 } as const, 429, "17"],
    [{ status: "rate_limit_unavailable", retryAfterSeconds: 5 } as const, 503, "5"],
  ])("maps %j to status %i", async (result, status, retryAfter) => {
    const response = authenticatedApplicationFailureResponse(
      result as Exclude<AuthenticatedApplicationResult, { status: "allowed" }>,
    );

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ error: result.status });
    expect(response.headers.get("cache-control")).toBe(retryAfter ? "no-store" : null);
    expect(response.headers.get("retry-after")).toBe(retryAfter);
  });
});
