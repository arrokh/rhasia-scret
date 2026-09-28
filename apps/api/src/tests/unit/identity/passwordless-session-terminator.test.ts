import { describe, expect, it, vi } from "vitest";
import type { PasswordlessAuthService } from "@api/modules/identity/application/passwordless-authentication";
import { PasswordlessSessionTerminator } from "@api/modules/identity/infrastructure/passwordless-session-terminator";
import { ResponseCookieStore } from "@api/http/cookies";

describe("PasswordlessSessionTerminator", () => {
  it("revokes a refresh-cookie session and clears browser credentials", async () => {
    const verifyAccessToken = vi.fn();
    const revoke = vi.fn().mockResolvedValue(undefined);
    const service = { verifyAccessToken, revoke } as unknown as PasswordlessAuthService;
    const cookies = new ResponseCookieStore();

    await new PasswordlessSessionTerminator(service).terminateCurrentSession(
      new Request("https://api.example.test/v1/auth/session/revoke", {
        headers: { cookie: "rhsia-passwordless-refresh=session-1.refresh-token" },
      }),
      cookies,
    );

    expect(revoke).toHaveBeenCalledWith("session-1");
    expect(verifyAccessToken).not.toHaveBeenCalled();
    expect(cookies.getAll().join("\n")).toContain("Max-Age=0");
  });

  it("revokes the session behind an access cookie when no refresh cookie exists", async () => {
    const verifyAccessToken = vi.fn().mockResolvedValue({ sessionId: "session-2" });
    const revoke = vi.fn().mockResolvedValue(undefined);
    const service = { verifyAccessToken, revoke } as unknown as PasswordlessAuthService;
    const cookies = new ResponseCookieStore();

    await new PasswordlessSessionTerminator(service).terminateCurrentSession(
      new Request("https://api.example.test/v1/auth/session/revoke", {
        headers: { cookie: "rhsia-passwordless-access=access.token" },
      }),
      cookies,
    );

    expect(verifyAccessToken).toHaveBeenCalledWith("access.token");
    expect(revoke).toHaveBeenCalledWith("session-2");
  });
});
