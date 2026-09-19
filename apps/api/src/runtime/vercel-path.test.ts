import { describe, expect, it } from "vitest";
import { normalizeVercelRequest } from "@api/runtime/vercel-path";

describe("Vercel API path normalization", () => {
  it("removes the function prefix while preserving query strings", () => {
    const request = normalizeVercelRequest(new Request("https://api.example.test/api/v1/health?probe=1"));
    expect(new URL(request.url).pathname).toBe("/v1/health");
    expect(new URL(request.url).search).toBe("?probe=1");
  });

  it("leaves canonical public API paths unchanged", () => {
    const request = normalizeVercelRequest(new Request("https://api.example.test/v1/health"));
    expect(new URL(request.url).pathname).toBe("/v1/health");
  });
});
