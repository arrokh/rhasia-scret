import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { requestApi } = vi.hoisted(() => ({ requestApi: vi.fn() }));
vi.mock("@/shared/infrastructure/server-api-gateway", () => ({ requestApi }));

import { createLogoutHandler } from "@/app/auth/logout/route";

describe("POST /auth/logout contract", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_APP_ORIGIN", "https://vault.example.test");
    requestApi.mockResolvedValue(new Response(null, { status: 204 }));
  });
  afterEach(() => vi.unstubAllEnvs());

  it("revokes through the API and redirects with a success status", async () => {
    const response = await createLogoutHandler()(request());
    expect(requestApi).toHaveBeenCalledWith("/v1/auth/session/revoke", { method: "POST" });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://vault.example.test/sign-in?auth=signed_out");
  });

  it("redirects to a redacted failure state when the API fails", async () => {
    requestApi.mockRejectedValueOnce(new Error("provider details"));
    const response = await createLogoutHandler()(request());
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://vault.example.test/sign-in?auth=logout_failed");
    expect(response.headers.get("location")).not.toContain("provider");
  });

  it("rejects a non-same-origin logout request", async () => {
    const response = await createLogoutHandler()(request("https://attacker.example.test"));
    expect(response.status).toBe(403);
    expect(requestApi).not.toHaveBeenCalled();
  });
});

function request(origin: string | null = "https://vault.example.test"): NextRequest {
  return new NextRequest("https://vault.example.test/auth/logout", {
    method: "POST",
    headers: origin ? { origin } : undefined,
  });
}
