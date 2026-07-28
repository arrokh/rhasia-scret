import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  cookies: vi.fn()
}));

vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.createServerClient }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));

import { GET } from "@/app/auth/confirm/route";

describe("GET /auth/confirm contract", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://supabase.example.test");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-key");
    mocks.cookies.mockResolvedValue({ getAll: vi.fn().mockReturnValue([]), set: vi.fn() });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("sends malformed callbacks to sign in", async () => {
    const response = await GET(request("/auth/confirm"));

    expect(response.headers.get("location")).toBe("https://vault.example.test/sign-in?auth=missing_code");
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });

  it("sends callbacks to sign in when authentication is not configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");

    const response = await GET(request("/auth/confirm?code=valid"));

    expect(response.headers.get("location")).toBe("https://vault.example.test/sign-in?auth=configuration_error");
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });

  it("sends failed verification to sign in without exposing provider details", async () => {
    mocks.createServerClient.mockReturnValue({
      auth: { exchangeCodeForSession: vi.fn().mockResolvedValue({ error: new Error("provider details") }) }
    });

    const response = await GET(request("/auth/confirm?code=invalid"));

    expect(response.headers.get("location")).toBe("https://vault.example.test/sign-in?auth=verification_failed");
    expect(response.headers.get("location")).not.toContain("provider");
  });

  it("keeps successful authentication directed to vaults", async () => {
    mocks.createServerClient.mockReturnValue({
      auth: { exchangeCodeForSession: vi.fn().mockResolvedValue({ error: null }) }
    });

    const response = await GET(request("/auth/confirm?code=valid"));

    expect(response.headers.get("location")).toBe("https://vault.example.test/vaults");
  });
});

function request(pathname: string): NextRequest {
  return new NextRequest(`https://vault.example.test${pathname}`);
}
