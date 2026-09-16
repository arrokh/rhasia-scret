import { describe, expect, it, vi } from "vitest";
import type { PasswordlessAuthService } from "@api/modules/identity/application/passwordless-authentication";
import { PasswordlessSessionTerminator } from "@api/modules/identity/infrastructure/passwordless-session-terminator";
import { ResponseCookieStore } from "@api/http/cookies";

describe("PasswordlessSessionTerminator", () => {
  it("revokes a native bearer session and clears browser credentials", async () => {
    const verifyAccessToken = vi.fn().mockResolvedValue({ sessionId: "session-1" });
    const revoke = vi.fn().mockResolvedValue(undefined);
    const service = { verifyAccessToken, revoke } as unknown as PasswordlessAuthService;
    const cookies = new ResponseCookieStore();

    await new PasswordlessSessionTerminator(service).terminateCurrentSession(
      new Request("https://api.example.test/v1/auth/session/revoke", {
        headers: { authorization: "Bearer access.token" },
      }),
      cookies,
    );

    expect(verifyAccessToken).toHaveBeenCalledWith("access.token");
    expect(revoke).toHaveBeenCalledWith("session-1");
    expect(cookies.getAll().join("\n")).toContain("Max-Age=0");
  });

  it("prefers a refresh cookie and does not verify an access token twice", async () => {
    const verifyAccessToken = vi.fn();
    const revoke = vi.fn().mockResolvedValue(undefined);
    const service = { verifyAccessToken, revoke } as unknown as PasswordlessAuthService;
    const cookies = new ResponseCookieStore();

    await new PasswordlessSessionTerminator(service).terminateCurrentSession(
      new Request("https://api.example.test/v1/auth/session/revoke", {
        headers: { cookie: "rhsia-passwordless-refresh=session-2.refresh; rhsia-passwordless-access=access" },
      }),
      cookies,
    );

    expect(revoke).toHaveBeenCalledWith("session-2");
    expect(verifyAccessToken).not.toHaveBeenCalled();
  });
});
