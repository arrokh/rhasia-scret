import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/healthz/route";

describe("self-hosted health route", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("allows loopback probes when the configured public origin is HTTPS", async () => {
    vi.stubEnv("WEB_ORIGIN", "https://web.example.test");
    const request = new NextRequest("http://127.0.0.1:3000/healthz");

    const response = GET(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });
});
