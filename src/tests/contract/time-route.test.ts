import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/time/route";

describe("GET /api/time contract", () => {
  it("returns an uncached ISO server time", async () => {
    const response = GET();
    expect(response.headers.get("cache-control")).toBe("no-store");
    const { now } = await response.json() as { now: string };
    expect(Number.isFinite(new Date(now).getTime())).toBe(true);
  });
});
