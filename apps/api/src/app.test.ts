import { describe, expect, it, vi } from "vitest";
import { app } from "@api/app";
import type { ApiBindings } from "@api/types";

const bindings: ApiBindings = {
  WEB_ORIGIN: "https://rhasia-scret.nooroctavian.id",
  PROXY_SECRET: "proxy-secret-that-is-long-enough-for-tests-123456",
};

describe("versioned API shell", () => {
  it("serves health and time only under the canonical version prefix", async () => {
    const health = await app.request("https://api.example.test/v1/health", {}, bindings);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: "ok" });
    expect(health.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(health.headers.get("cache-control")).toBe("no-store");

    const correlated = await app.request(
      "https://api.example.test/v1/health",
      { headers: { "x-request-id": "0123456789abcdef0123456789abcdef" } },
      bindings,
    );
    expect(correlated.headers.get("x-request-id")).toBe("0123456789abcdef0123456789abcdef");

    const untrustedCorrelation = await app.request(
      "https://api.example.test/v1/health",
      { headers: { "x-request-id": "person@example.test" } },
      bindings,
    );
    expect(untrustedCorrelation.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);

    const time = await app.request("https://api.example.test/v1/time", {}, bindings);
    expect(time.status).toBe(200);
    expect(time.headers.get("cache-control")).toBe("no-store");
    expect((await time.json()) as { now: string }).toMatchObject({ now: expect.any(String) });
  });

  it("does not expose an unversioned alias", async () => {
    const response = await app.request("https://api.example.test/health", {}, bindings);
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "not_found" });
  });

  it("logs implementation request metadata without logging request bodies", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const response = await app.request(
        "https://api.example.test/v1/me",
        {
          method: "POST",
          headers: { "content-type": "application/json", "x-request-id": "abcdef0123456789abcdef0123456789" },
          body: JSON.stringify({ secret: "request-body-secret" }),
        },
        bindings,
      );

      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const requestLog = errorSpy.mock.calls
        .map(([line]) => JSON.parse(String(line)))
        .find((entry) => entry.event === "api_request");
      expect(requestLog).toMatchObject({
        event: "api_request",
        requestId: "abcdef0123456789abcdef0123456789",
        method: "POST",
        path: "/v1/me",
        status: 503,
      });
      expect(requestLog.durationMs).toEqual(expect.any(Number));
      expect(errorSpy.mock.calls.flat().join(" ")).not.toContain("request-body-secret");
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("allows the configured web origin and rejects other direct browser origins", async () => {
    const allowed = await app.request(
      "https://api.example.test/v1/health",
      { headers: { origin: bindings.WEB_ORIGIN as string } },
      bindings,
    );
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get("access-control-allow-origin")).toBe(bindings.WEB_ORIGIN);

    const rejected = await app.request(
      "https://api.example.test/v1/health",
      { headers: { origin: "https://evil.example.test" } },
      bindings,
    );
    expect(rejected.status).toBe(200);
    expect(rejected.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("rejects an invalid proxy marker without exposing the configured secret", async () => {
    const response = await app.request(
      "https://api.example.test/v1/health",
      { headers: { "x-rhasia-proxy-secret": "wrong" } },
      bindings,
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
    expect(response.headers.get("x-rhasia-proxy-secret")).toBeNull();
  });

  it("rejects direct cookie-bearing session revocation without the trusted proxy marker", async () => {
    const response = await app.request(
      "https://api.example.test/v1/auth/session/revoke",
      { method: "POST", headers: { cookie: "rhsia-session=opaque" } },
      { ...bindings, AUTH_BACKEND: "none", DATABASE_CLIENT: {} as NonNullable<ApiBindings["DATABASE_CLIENT"]> },
    );
    expect(response.status).toBe(403);
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
