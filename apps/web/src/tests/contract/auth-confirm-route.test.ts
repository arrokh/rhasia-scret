import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { AUTH_RETURN_PATH_COOKIE } from "@/modules/identity/application/auth-return-path";

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  cookies: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.createServerClient }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));

import { GET } from "@/app/auth/confirm/route";

describe("GET /auth/confirm contract", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://supabase.example.test");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-key");
    mocks.cookies.mockResolvedValue({
      get: vi.fn().mockReturnValue(undefined),
      getAll: vi.fn().mockReturnValue([]),
      set: vi.fn(),
    });
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

  it("preserves the invitation return path for malformed callbacks", async () => {
    const response = await GET(request("/auth/confirm?next=%2Fvaults%2Finvitations%2Fredeem"));

    expect(response.headers.get("location")).toBe(
      "https://vault.example.test/sign-in?auth=missing_code&next=%2Fvaults%2Finvitations%2Fredeem",
    );
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
      auth: { exchangeCodeForSession: vi.fn().mockResolvedValue({ error: new Error("provider details") }) },
    });

    const response = await GET(request("/auth/confirm?code=invalid"));

    expect(response.headers.get("location")).toBe("https://vault.example.test/sign-in?auth=verification_failed");
    expect(response.headers.get("location")).not.toContain("provider");
  });

  it("keeps successful authentication directed to vaults", async () => {
    mocks.createServerClient.mockReturnValue({
      auth: { exchangeCodeForSession: vi.fn().mockResolvedValue({ error: null }) },
    });

    const response = await GET(request("/auth/confirm?code=valid"));

    expect(response.headers.get("location")).toBe("https://vault.example.test/vaults");
  });

  it("returns a successfully authenticated invitation recipient to redemption", async () => {
    mocks.createServerClient.mockReturnValue({
      auth: { exchangeCodeForSession: vi.fn().mockResolvedValue({ error: null }) },
    });

    const response = await GET(request("/auth/confirm?code=valid&next=%2Fvaults%2Finvitations%2Fredeem"));

    expect(response.headers.get("location")).toBe("https://vault.example.test/auth/complete");
  });

  it("uses the short-lived invitation return cookie when the provider callback has no next parameter", async () => {
    const cookieStore = {
      get: vi.fn((name: string) =>
        name === AUTH_RETURN_PATH_COOKIE ? { value: "/vaults/invitations/redeem" } : undefined,
      ),
      getAll: vi.fn().mockReturnValue([]),
      set: vi.fn(),
    };
    mocks.cookies.mockResolvedValue(cookieStore);
    mocks.createServerClient.mockReturnValue({
      auth: { exchangeCodeForSession: vi.fn().mockResolvedValue({ error: null }) },
    });

    const response = await GET(request("/auth/confirm?code=valid"));

    expect(response.headers.get("location")).toBe("https://vault.example.test/auth/complete");
    expect(cookieStore.set).toHaveBeenCalledWith(AUTH_RETURN_PATH_COOKIE, "", expect.objectContaining({ maxAge: 0 }));
  });

  it("verifies token-hash callbacks through the fixed callback protocol", async () => {
    const verifyOtp = vi.fn().mockResolvedValue({ error: null });
    mocks.createServerClient.mockReturnValue({ auth: { verifyOtp } });

    const response = await GET(request("/auth/confirm?token_hash=valid&type=email"));

    expect(response.headers.get("location")).toBe("https://vault.example.test/vaults");
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: "valid", type: "email" });
  });

  it("rejects callbacks that contain multiple provider protocols", async () => {
    const response = await GET(request("/auth/confirm?code=valid&token_hash=also-valid"));

    expect(response.headers.get("location")).toBe("https://vault.example.test/sign-in?auth=verification_failed");
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });

  it("ignores an unsafe return path", async () => {
    mocks.createServerClient.mockReturnValue({
      auth: { exchangeCodeForSession: vi.fn().mockResolvedValue({ error: null }) },
    });

    const response = await GET(request("/auth/confirm?code=valid&next=https%3A%2F%2Fattacker.example"));

    expect(response.headers.get("location")).toBe("https://vault.example.test/vaults");
  });
});

function request(pathname: string): NextRequest {
  return new NextRequest(`https://vault.example.test${pathname}`);
}
