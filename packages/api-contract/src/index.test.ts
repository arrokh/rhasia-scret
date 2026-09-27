import { describe, expect, it } from "vitest";
import {
  API_ROUTE_MANIFEST,
  API_VERSION_PREFIX,
  apiErrorSchema,
  apiPath,
  browserApiPath,
  healthResponseSchema,
  isVersionedApiPath,
  timeResponseSchema,
} from "./index";

describe("API contract", () => {
  it("declares every canonical API operation exactly once", () => {
    expect(API_ROUTE_MANIFEST).toHaveLength(63);
    expect(new Set(API_ROUTE_MANIFEST.map(([method, path]) => `${method} ${path}`)).size).toBe(63);
  });

  it("keeps the version segment canonical and browser-only proxy prefix separate", () => {
    expect(API_VERSION_PREFIX).toBe("/v1");
    expect(apiPath("health")).toBe("/v1/health");
    expect(apiPath("/v1/time")).toBe("/v1/time");
    expect(browserApiPath("/time")).toBe("/api/v1/time");
    expect(isVersionedApiPath("/v1/health")).toBe(true);
    expect(isVersionedApiPath("/health")).toBe(false);
  });

  it("validates public success and generic error envelopes", () => {
    expect(healthResponseSchema.parse({ status: "ok" })).toEqual({ status: "ok" });
    expect(timeResponseSchema.parse({ now: "2026-09-16T00:00:00.000Z" })).toEqual({
      now: "2026-09-16T00:00:00.000Z",
    });
    expect(apiErrorSchema.parse({ error: "not_found", requestId: "safe-id" }).error).toBe("not_found");
  });
});
