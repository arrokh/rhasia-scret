import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createLogoutHandler } from "@/app/auth/logout/route";

describe("POST /auth/logout contract", () => {
  it("terminates the current session and redirects with a success status", async () => {
    const terminateCurrentSession = vi.fn().mockResolvedValue(undefined);
    const response = await createLogoutHandler({ sessionTerminator: { terminateCurrentSession } })(request());

    expect(terminateCurrentSession).toHaveBeenCalledOnce();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://vault.example.test/?auth=signed_out");
  });

  it("keeps stale-session logout idempotent", async () => {
    const response = await createLogoutHandler({
      sessionTerminator: { terminateCurrentSession: vi.fn().mockResolvedValue(undefined) }
    })(request());

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("auth=signed_out");
  });

  it("accepts same-origin submissions behind a trusted reverse proxy", async () => {
    const terminateCurrentSession = vi.fn().mockResolvedValue(undefined);
    const proxiedRequest = new NextRequest("http://internal:3000/auth/logout", {
      method: "POST",
      headers: {
        origin: "https://vault.example.test",
        host: "internal:3000",
        "x-forwarded-host": "vault.example.test",
        "x-forwarded-proto": "https"
      }
    });
    const response = await createLogoutHandler({ sessionTerminator: { terminateCurrentSession } })(proxiedRequest);

    expect(response.status).toBe(303);
    expect(terminateCurrentSession).toHaveBeenCalledOnce();
  });

  it("redirects to a redacted failure state when termination fails", async () => {
    const response = await createLogoutHandler({
      sessionTerminator: { terminateCurrentSession: vi.fn().mockRejectedValue(new Error("provider details")) }
    })(request());

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://vault.example.test/?auth=logout_failed");
    expect(response.headers.get("location")).not.toContain("provider");
  });

  it.each([null, "https://attacker.example.test"])("rejects a non-same-origin logout request from %s", async (origin) => {
    const terminateCurrentSession = vi.fn();
    const response = await createLogoutHandler({ sessionTerminator: { terminateCurrentSession } })(request(origin));

    expect(response.status).toBe(403);
    expect(terminateCurrentSession).not.toHaveBeenCalled();
  });
});

function request(origin: string | null = "https://vault.example.test"): NextRequest {
  return new NextRequest("https://vault.example.test/auth/logout", {
    method: "POST",
    headers: origin ? { origin } : undefined
  });
}
