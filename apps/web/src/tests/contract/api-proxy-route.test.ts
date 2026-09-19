import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/[...path]/route";

const env = {
  API_ORIGIN: process.env.API_ORIGIN,
  API_PROXY_SECRET: process.env.API_PROXY_SECRET,
  WEB_ORIGIN: process.env.WEB_ORIGIN,
};

function request(path: string, init?: ConstructorParameters<typeof NextRequest>[1]): NextRequest {
  return new NextRequest(`https://web.example.test${path}`, init);
}

afterEach(() => {
  vi.restoreAllMocks();
  process.env.API_ORIGIN = env.API_ORIGIN;
  process.env.API_PROXY_SECRET = env.API_PROXY_SECRET;
  process.env.WEB_ORIGIN = env.WEB_ORIGIN;
});

describe("web API proxy", () => {
  it("forwards canonical paths, credentials, proxy trust, and response cookies", async () => {
    process.env.API_ORIGIN = "https://api.example.test";
    process.env.API_PROXY_SECRET = "proxy-secret-that-is-long-enough-for-tests-123456";
    process.env.WEB_ORIGIN = "https://web.example.test";
    const upstreamHeaders = new Headers({
      "content-type": "application/json",
      location: "https://api.example.test/v1/auth/complete?ok=1",
    });
    upstreamHeaders.append("set-cookie", "session=one; HttpOnly; Secure; SameSite=Lax; Path=/");
    upstreamHeaders.append("set-cookie", "refresh=two; HttpOnly; Secure; SameSite=Lax; Path=/");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 201, headers: upstreamHeaders })),
    );

    const response = await POST(
      request("/api/v1/auth/session/refresh", {
        method: "POST",
        headers: {
          cookie: "session=opaque",
          origin: "https://web.example.test",
          referer: "https://web.example.test/auth/confirm?code=provider-code",
          "content-type": "application/json",
          "x-request-id": "0123456789abcdef0123456789abcdef",
        },
        body: JSON.stringify({ client: "web" }),
      }),
      { params: Promise.resolve({ path: ["v1", "auth", "session", "refresh"] }) },
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("location")).toBe("https://web.example.test/v1/auth/complete?ok=1");
    expect(response.headers.get("x-request-id")).toBe("0123456789abcdef0123456789abcdef");
    expect(response.headers.get("set-cookie")).toContain("session=one");
    expect(response.headers.get("set-cookie")).toContain("refresh=two");
    expect(vi.mocked(fetch)).toHaveBeenCalledOnce();
    const [url, options] = vi.mocked(fetch).mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe("https://api.example.test/v1/auth/session/refresh");
    expect(new Headers(options.headers).get("x-rhasia-proxy-secret")).toBe(process.env.API_PROXY_SECRET);
    expect(new Headers(options.headers).get("cookie")).toBe("session=opaque");
    expect(new Headers(options.headers).get("referer")).toBeNull();
  });

  it("allows safe reads without an Origin header but rejects cookie mutations without one", async () => {
    process.env.API_ORIGIN = "https://api.example.test";
    process.env.API_PROXY_SECRET = "proxy-secret-that-is-long-enough-for-tests-123456";
    process.env.WEB_ORIGIN = "https://web.example.test";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("ok")));

    const read = await GET(request("/api/v1/health"), { params: Promise.resolve({ path: ["v1", "health"] }) });
    expect(read.status).toBe(200);

    const mutation = await POST(
      request("/api/v1/auth/session/refresh", {
        method: "POST",
        headers: { cookie: "session=opaque" },
        body: "{}",
      }),
      { params: Promise.resolve({ path: ["v1", "auth", "session", "refresh"] }) },
    );
    expect(mutation.status).toBe(403);
    expect(vi.mocked(fetch)).toHaveBeenCalledOnce();
  });

  it("logs proxy failures without logging request data or error details", async () => {
    process.env.API_ORIGIN = "https://api.example.test";
    process.env.API_PROXY_SECRET = "proxy-secret-that-is-long-enough-for-tests-123456";
    process.env.WEB_ORIGIN = "https://web.example.test";
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("provider secret must not be logged")));

    const response = await GET(
      request("/api/v1/personal-vault", { headers: { "x-request-id": "abcdef0123456789abcdef0123456789" } }),
      { params: Promise.resolve({ path: ["v1", "personal-vault"] }) },
    );

    expect(response.status).toBe(502);
    expect(response.headers.get("x-request-id")).toBe("abcdef0123456789abcdef0123456789");
    expect(errorSpy).toHaveBeenCalledWith(
      JSON.stringify({
        event: "web_api_proxy_failure",
        requestId: "abcdef0123456789abcdef0123456789",
        method: "GET",
        path: "/api/v1/personal-vault",
        status: 502,
        error: "upstream_unavailable",
        errorType: "Error",
      }),
    );
    expect(errorSpy.mock.calls.flat().join(" ")).not.toContain("provider secret must not be logged");
  });

  it("does not expose unversioned proxy aliases", async () => {
    const response = await GET(request("/api/health"), { params: Promise.resolve({ path: ["health"] }) });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
  });
});
