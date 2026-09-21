import { describe, expect, it } from "vitest";
import { createVercelSystemResponse } from "@api/runtime/vercel-system";

const bindings = {
  PROXY_SECRET: "proxy-secret-that-is-long-enough-for-tests-123456",
  WEB_ORIGIN: "https://rhasia-scret.nooroctavian.id",
};

describe("Vercel system handlers", () => {
  it("preserves the health response and security headers", async () => {
    const response = createVercelSystemResponse(
      new Request("https://api.example.test/api/health", {
        headers: {
          origin: bindings.WEB_ORIGIN,
          "x-request-id": "0123456789abcdef0123456789abcdef",
        },
      }),
      "health",
      bindings,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toBe("application/json; charset=UTF-8");
    expect(response.headers.get("x-request-id")).toBe("0123456789abcdef0123456789abcdef");
    expect(response.headers.get("access-control-allow-origin")).toBe(bindings.WEB_ORIGIN);
    expect(response.headers.get("access-control-expose-headers")).toBe("etag,last-modified,x-request-id,retry-after");
    expect(response.headers.get("vary")).toBe("Origin");
  });

  it("supports empty HEAD responses and preflight OPTIONS responses", async () => {
    const head = createVercelSystemResponse(
      new Request("https://api.example.test/api/time", { method: "HEAD" }),
      "time",
      bindings,
    );
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect(head.headers.get("content-type")).toBe("application/json; charset=UTF-8");

    const options = createVercelSystemResponse(
      new Request("https://api.example.test/api/time", {
        method: "OPTIONS",
        headers: { origin: bindings.WEB_ORIGIN },
      }),
      "time",
      bindings,
    );
    expect(options.status).toBe(204);
    expect(await options.text()).toBe("");
    expect(options.headers.get("access-control-allow-methods")).toBe("GET,POST,PATCH,PUT,DELETE,OPTIONS");
    expect(options.headers.get("access-control-allow-headers")).toBe(
      "content-type,authorization,if-none-match,if-match,x-request-id",
    );
    expect(options.headers.get("access-control-max-age")).toBe("600");
    expect(options.headers.get("vary")).toBe("Origin, Access-Control-Request-Headers");
  });

  it("rejects an invalid proxy marker before applying CORS", async () => {
    const response = createVercelSystemResponse(
      new Request("https://api.example.test/api/health", {
        headers: {
          origin: bindings.WEB_ORIGIN,
          "x-rhasia-proxy-secret": "wrong",
        },
      }),
      "health",
      bindings,
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("keeps unsupported methods as not found and returns a valid time payload", async () => {
    const unsupported = createVercelSystemResponse(
      new Request("https://api.example.test/api/time", { method: "POST" }),
      "time",
      bindings,
    );
    expect(unsupported.status).toBe(404);
    expect(await unsupported.json()).toEqual({ error: "not_found" });

    const time = createVercelSystemResponse(new Request("https://api.example.test/api/time"), "time", bindings);
    expect(time.status).toBe(200);
    expect((await time.json()) as { now: string }).toMatchObject({ now: expect.any(String) });
  });
});
