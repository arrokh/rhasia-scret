import { describe, expect, it } from "vitest";
import { z } from "zod";
import { readBoundedRequestBody, safeParseJsonBody } from "./validation";

describe("bounded JSON request validation", () => {
  it("rejects an oversized body before schema parsing", async () => {
    const schema = z.object({ value: z.string() }).strict();
    const request = new Request("https://api.example.test/v1/test", {
      method: "POST",
      body: JSON.stringify({ value: "x".repeat(2_000) }),
    });

    const parsed = await safeParseJsonBody(request, schema, 1_024);

    expect(parsed.success).toBe(false);
  });

  it("reads a chunked body up to the configured limit", async () => {
    const request = new Request("https://api.example.test/v1/test", {
      method: "POST",
      body: JSON.stringify({ value: "bounded" }),
    });

    await expect(readBoundedRequestBody(request, 1_024)).resolves.toBe('{"value":"bounded"}');
  });
});
