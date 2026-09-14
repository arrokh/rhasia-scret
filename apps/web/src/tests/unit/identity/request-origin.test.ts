import { describe, expect, it, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { isSameOrigin, requestClientIp, requestPublicOrigin } from "@/modules/identity/infrastructure/request-origin";

describe("request origin", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("uses the configured application origin instead of forwarded headers", () => {
    vi.stubEnv("AUTH_APP_ORIGIN", "https://vault.example.test");
    const request = new NextRequest("http://internal:3000/auth/logout", {
      headers: {
        origin: "https://vault.example.test",
        host: "internal:3000",
        "x-forwarded-host": "attacker.example.test",
        "x-forwarded-proto": "https",
      },
    });

    expect(requestPublicOrigin(request)).toBe("https://vault.example.test");
    expect(isSameOrigin(request)).toBe(true);
    expect(
      isSameOrigin(
        new NextRequest("http://internal:3000/auth/logout", {
          headers: {
            origin: "https://attacker.example.test",
            "x-forwarded-host": "attacker.example.test",
            "x-forwarded-proto": "https",
          },
        }),
      ),
    ).toBe(false);
  });

  it("does not trust forwarded client IP headers unless the proxy is explicitly trusted", () => {
    const request = new NextRequest("https://vault.example.test/api/auth/magic-link/request", {
      headers: { "x-forwarded-for": "198.51.100.10", "x-real-ip": "198.51.100.11" },
    });

    expect(requestClientIp(request)).toBeNull();
    vi.stubEnv("AUTH_TRUST_PROXY_HEADERS", "true");
    expect(requestClientIp(request)).toBe("198.51.100.10");
  });

  it("uses the configured OIDC redirect origin even when its callback has a path", () => {
    vi.stubEnv("AUTH_BACKEND", "oidc");
    vi.stubEnv("OIDC_REDIRECT_URI", "https://vault.example.test/auth/oidc/callback");
    const request = new NextRequest("http://internal:3000/auth/logout", {
      headers: { origin: "https://vault.example.test", "x-forwarded-host": "attacker.example.test" },
    });

    expect(requestPublicOrigin(request)).toBe("https://vault.example.test");
  });
});
