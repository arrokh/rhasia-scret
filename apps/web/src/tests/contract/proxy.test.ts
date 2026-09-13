import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createAuthProxy, isProtectedPagePath } from "@/proxy";
import { AUTH_RETURN_PATH_COOKIE } from "@/modules/identity/application/auth-return-path";

describe("authentication proxy contract", () => {
  it.each(["/vaults", "/vaults/shared", "/vaults/invitations/redeem", "/totp"])(
    "classifies %s as a protected page",
    (pathname) => {
      expect(isProtectedPagePath(pathname)).toBe(true);
    },
  );

  it.each([
    "/",
    "/sign-in",
    "/auth/confirm",
    "/auth/complete",
    "/api/health",
    "/api/time",
    "/smoke",
    "/ui-preview",
    "/vaultsmith",
  ])("keeps %s public", (pathname) => {
    expect(isProtectedPagePath(pathname)).toBe(false);
  });

  it("allows an authenticated request to a protected page", async () => {
    const verifySession = vi.fn().mockResolvedValue(true);
    const response = await createAuthProxy(verifySession)(request("/vaults"));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("x-middleware-request-x-nonce")).toBeTruthy();
    expect(response.headers.get("server-timing")).toMatch(/^auth_claims;dur=\d+\.\d{2}$/);
    expect(response.headers.get("content-security-policy")).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    expect(response.headers.get("content-security-policy")).toMatch(/script-src-elem 'self' 'nonce-[^']+'/);
    expect(response.headers.get("content-security-policy")).toContain("https://static.cloudflareinsights.com");
    expect(response.headers.get("content-security-policy")).toContain("https://cloudflareinsights.com");
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

  it("preserves the safe invitation return path when access is required", async () => {
    const response = await createAuthProxy(async () => false)(request("/vaults/invitations/redeem"));

    expect(response.headers.get("location")).toBe(
      "https://vault.example.test/sign-in?auth=required&next=%2Fvaults%2Finvitations%2Fredeem",
    );
  });

  it("fails closed when stale-session verification throws", async () => {
    const response = await createAuthProxy(async () => {
      throw new Error("expired session");
    })(request("/totp"));

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

  it("redirects a root provider error to a safe sign-in notice", async () => {
    const verifySession = vi.fn().mockResolvedValue(false);
    const response = await createAuthProxy(verifySession)(
      request(
        "/?error=access_denied&error_code=otp_expired&error_description=" +
          encodeURIComponent("attacker-controlled-description"),
      ),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://vault.example.test/sign-in?auth=link_expired");
    expect(response.headers.get("location")).not.toContain("attacker-controlled-description");
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    expect(verifySession).not.toHaveBeenCalled();
  });

  it("preserves and clears the invitation return path for a root provider error", async () => {
    const response = await createAuthProxy(async () => false)(
      request(
        "/?error=access_denied&error_code=otp_expired",
        undefined,
        `${AUTH_RETURN_PATH_COOKIE}=%2Fvaults%2Finvitations%2Fredeem`,
      ),
    );

    expect(response.headers.get("location")).toBe(
      "https://vault.example.test/sign-in?auth=link_expired&next=%2Fvaults%2Finvitations%2Fredeem",
    );
    expect(response.cookies.get(AUTH_RETURN_PATH_COOKIE)).toMatchObject({ value: "", maxAge: 0 });
  });

  it("forwards a root provider code to the auth callback", async () => {
    const verifySession = vi.fn().mockResolvedValue(false);
    const response = await createAuthProxy(verifySession)(request("/?code=provider-code"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://vault.example.test/auth/confirm?code=provider-code");
    expect(verifySession).not.toHaveBeenCalled();
  });

  it("prevents API and auth responses from being cached", async () => {
    const api = await createAuthProxy(async () => false)(request("/api/time"));
    const auth = await createAuthProxy(async () => false)(request("/auth/confirm"));

    expect(api.headers.get("cache-control")).toBe("no-store, private");
    expect(auth.headers.get("cache-control")).toBe("no-store, private");
  });
});

function request(pathname: string, locale?: string, cookie?: string): NextRequest {
  const cookies = [locale ? `RHSIA_LOCALE=${locale}` : null, cookie].filter(Boolean).join("; ");
  return new NextRequest(
    `https://vault.example.test${pathname}`,
    cookies ? { headers: { cookie: cookies } } : undefined,
  );
}
