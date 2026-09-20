import { describe, expect, it } from "vitest";
import { isClientOriginAllowed, isSameOrigin, isSameOriginIfPresent, requestClientIp } from "./request-origin";

describe("request origin policy", () => {
  const requestUrl = "https://api.example.test/v1/auth/session";

  it("requires a matching origin for browser clients", () => {
    expect(isClientOriginAllowed(requestWithOrigin("https://api.example.test"), "web")).toBe(true);
    expect(isClientOriginAllowed(requestWithOrigin("https://other.example.test"), "pwa")).toBe(false);
    expect(isClientOriginAllowed(new Request(requestUrl), "web")).toBe(false);
  });

  it("allows native clients without an Origin header", () => {
    expect(isClientOriginAllowed(new Request(requestUrl), "mobile")).toBe(true);
    expect(isClientOriginAllowed(requestWithOrigin("https://api.example.test"), "mobile")).toBe(true);
    expect(isClientOriginAllowed(requestWithOrigin("https://other.example.test"), "mobile")).toBe(false);
  });

  it("validates an Origin only when the request supplies one", () => {
    expect(isSameOriginIfPresent(new Request(requestUrl))).toBe(true);
    expect(isSameOriginIfPresent(requestWithOrigin("https://other.example.test"))).toBe(false);
    expect(isSameOrigin(requestWithOrigin("https://api.example.test"))).toBe(true);
  });

  it("accepts client IP metadata only from the trusted proxy path", () => {
    expect(
      requestClientIp(
        new Request(requestUrl, {
          headers: { "cf-connecting-ip": "198.51.100.10", "x-rhasia-client-ip": "203.0.113.5" },
        }),
      ),
    ).toBeNull();
    expect(
      requestClientIp(
        new Request(requestUrl, {
          headers: {
            "x-rhasia-proxy-secret": "trusted",
            "x-rhasia-client-ip": "203.0.113.5",
          },
        }),
      ),
    ).toBe("203.0.113.5");
  });
});

function requestWithOrigin(origin: string): Request {
  return new Request("https://api.example.test/v1/auth/session", { headers: { origin } });
}
