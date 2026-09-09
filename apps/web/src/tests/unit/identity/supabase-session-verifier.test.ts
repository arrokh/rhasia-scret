import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getClaims: vi.fn(),
  getUser: vi.fn(),
  createServerClient: vi.fn(),
  cookies: vi.fn(),
  headers: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: mocks.cookies, headers: mocks.headers }));
vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.createServerClient }));

import { SupabaseSessionVerifier } from "@/modules/identity/infrastructure/supabase-session-verifier";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("SupabaseSessionVerifier", () => {
  function configure() {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://supabase.example.test");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-key");
    mocks.cookies.mockResolvedValue({ get: vi.fn(), getAll: vi.fn(() => []), set: vi.fn() });
    mocks.headers.mockResolvedValue({ get: vi.fn(() => null) });
    mocks.createServerClient.mockReturnValue({ auth: { getClaims: mocks.getClaims, getUser: mocks.getUser } });
  }

  it("supports verified JWT claims for proxy-style protected page reads", async () => {
    configure();
    mocks.getClaims.mockResolvedValue({
      data: {
        claims: {
          iss: "https://supabase.example.test/auth/v1",
          sub: "subject-1",
          email: "owner@example.test",
          email_verified: true,
        },
      },
      error: null,
    });

    await expect(new SupabaseSessionVerifier("claims").verify()).resolves.toEqual({
      issuer: "https://supabase.example.test/auth/v1",
      subject: "subject-1",
      email: "owner@example.test",
      emailVerified: true,
      assurance: "verified-claims",
      sessionId: undefined,
    });
    expect(mocks.getClaims).toHaveBeenCalledOnce();
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it("uses a fresh Auth user lookup by default for online mutations", async () => {
    configure();
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "subject-1", email: "fresh@example.test", email_confirmed_at: "2026-01-01T00:00:00.000Z" } },
      error: null,
    });

    await expect(new SupabaseSessionVerifier().verify()).resolves.toEqual({
      issuer: "https://supabase.example.test/auth/v1",
      subject: "subject-1",
      email: "fresh@example.test",
      emailVerified: true,
      assurance: "fresh-provider-user",
    });
    expect(mocks.getUser).toHaveBeenCalledWith(undefined);
    expect(mocks.getClaims).not.toHaveBeenCalled();
  });

  it("verifies a native bearer credential without placing it in cookie state", async () => {
    configure();
    mocks.headers.mockResolvedValue({ get: vi.fn(() => "Bearer mobile-access-token") });
    mocks.getClaims.mockResolvedValue({
      data: {
        claims: {
          iss: "https://supabase.example.test/auth/v1",
          sub: "subject-mobile",
          email: "mobile@example.test",
          email_verified: true,
        },
      },
      error: null,
    });

    await expect(new SupabaseSessionVerifier("claims").verify()).resolves.toMatchObject({
      subject: "subject-mobile",
      email: "mobile@example.test",
    });
    expect(mocks.getClaims).toHaveBeenCalledWith("mobile-access-token");
  });

  it("rejects malformed authorization without falling back to browser cookies", async () => {
    configure();
    mocks.headers.mockResolvedValue({ get: vi.fn(() => "Basic unexpected") });

    await expect(new SupabaseSessionVerifier().verify()).resolves.toBeNull();
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });
});
