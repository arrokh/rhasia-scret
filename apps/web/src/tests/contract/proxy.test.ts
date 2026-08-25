import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createAuthProxy, isProtectedPagePath } from "@/proxy";

describe("authentication proxy contract", () => {
  it.each(["/vaults", "/vaults/shared", "/totp"])("classifies %s as a protected page", (pathname) => {
    expect(isProtectedPagePath(pathname)).toBe(true);
  });

  it.each(["/", "/sign-in", "/auth/confirm", "/api/health", "/api/time", "/smoke", "/ui-preview", "/vaultsmith"])(
    "keeps %s public",
    (pathname) => {
      expect(isProtectedPagePath(pathname)).toBe(false);
    }
  );

  it("allows an authenticated request to a protected page", async () => {
    const verifySession = vi.fn().mockResolvedValue(true);
    const response = await createAuthProxy(verifySession)(request("/vaults"));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("x-middleware-request-x-nonce")).toBeTruthy();
    expect(response.headers.get("server-timing")).toMatch(/^auth_claims;dur=\d+\.\d{2}$/);
    expect(response.headers.get("content-security-policy")).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    expect(response.headers.get("content-security-policy")).toMatch(/script-src-elem 'self' 'nonce-[^']+'/);
    expect(response.headers.get("strict-transport-security")).toContain("preload");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("permissions-policy")).toContain("camera=(self)");
    expect(response.headers.get("cross-origin-opener-policy")).toBe("same-origin");
    expect(verifySession).toHaveBeenCalledOnce();
  });

  it.each(["id", "en", "malformed"])("keeps auth paths locale-independent for the %s cookie", async (locale) => {
    const response = await createAuthProxy(async () => false)(request("/vaults/shared?tab=accounts", locale));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://vault.example.test/sign-in?auth=required");
  });

  it("fails closed when stale-session verification throws", async () => {
    const response = await createAuthProxy(async () => { throw new Error("expired session"); })(request("/totp"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://vault.example.test/sign-in?auth=required");
  });

  it("preserves refreshed auth cookies on a redirect", async () => {
    const response = await createAuthProxy(async (_request, setAuthCookies) => {
      setAuthCookies([{ name: "sb-session", value: "", options: { path: "/", maxAge: 0, httpOnly: true } }]);
      return false;
    })(request("/vaults"));

    expect(response.cookies.get("sb-session")).toMatchObject({ value: "", path: "/", httpOnly: true });
  });

  it("does not block public routes when no session exists", async () => {
    const response = await createAuthProxy(async () => false)(request("/"));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("prevents API and auth responses from being cached", async () => {
    const api = await createAuthProxy(async () => false)(request("/api/time"));
    const auth = await createAuthProxy(async () => false)(request("/auth/confirm"));

    expect(api.headers.get("cache-control")).toBe("no-store, private");
    expect(auth.headers.get("cache-control")).toBe("no-store, private");
  });
});

function request(pathname: string, locale?: string): NextRequest {
  return new NextRequest(`https://vault.example.test${pathname}`, locale ? { headers: { cookie: `RHSIA_LOCALE=${locale}` } } : undefined);
}
