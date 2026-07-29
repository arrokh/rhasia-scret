import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getClaims: vi.fn(),
  getUser: vi.fn(),
  createServerClient: vi.fn(),
  cookies: vi.fn()
}));

vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
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
    mocks.createServerClient.mockReturnValue({ auth: { getClaims: mocks.getClaims, getUser: mocks.getUser } });
  }

  it("supports verified JWT claims for proxy-style protected page reads", async () => {
    configure();
    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: "subject-1", email: "owner@example.test" } }, error: null });

    await expect(new SupabaseSessionVerifier("claims").verify()).resolves.toEqual({ subject: "subject-1", email: "owner@example.test" });
    expect(mocks.getClaims).toHaveBeenCalledOnce();
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it("uses a fresh Auth user lookup by default for online mutations", async () => {
    configure();
    mocks.getUser.mockResolvedValue({ data: { user: { id: "subject-1", email: "fresh@example.test" } }, error: null });

    await expect(new SupabaseSessionVerifier().verify()).resolves.toEqual({ subject: "subject-1", email: "fresh@example.test" });
    expect(mocks.getUser).toHaveBeenCalledOnce();
    expect(mocks.getClaims).not.toHaveBeenCalled();
  });
});
