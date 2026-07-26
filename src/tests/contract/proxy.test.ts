import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createAuthProxy, isProtectedPagePath } from "@/proxy";

describe("authentication proxy contract", () => {
  it.each(["/vaults", "/vaults/shared", "/totp"])("classifies %s as a protected page", (pathname) => {
    expect(isProtectedPagePath(pathname)).toBe(true);
  });

  it.each(["/", "/auth/confirm", "/api/health", "/api/time", "/smoke", "/ui-preview", "/vaultsmith"])(
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
    expect(verifySession).toHaveBeenCalledOnce();
  });

  it("redirects an unauthenticated protected request to sign in", async () => {
    const response = await createAuthProxy(async () => false)(request("/vaults/shared?tab=accounts"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://vault.example.test/?auth=required");
  });

  it("fails closed when stale-session verification throws", async () => {
    const response = await createAuthProxy(async () => { throw new Error("expired session"); })(request("/totp"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://vault.example.test/?auth=required");
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
});

function request(pathname: string): NextRequest {
  return new NextRequest(`https://vault.example.test${pathname}`);
}
