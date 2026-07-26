import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadApplicationUser: vi.fn(),
  redirect: vi.fn()
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/modules/identity/application/load-application-user", () => ({
  loadApplicationUser: mocks.loadApplicationUser
}));
vi.mock("@/modules/identity/infrastructure/prisma-application-user-repository", () => ({
  PrismaApplicationUserRepository: class PrismaApplicationUserRepository {}
}));
vi.mock("@/modules/identity/infrastructure/supabase-session-verifier", () => ({
  SupabaseSessionVerifier: class SupabaseSessionVerifier {}
}));

import HomePage from "@/app/page";

describe("HomePage", () => {
  it("redirects an authenticated active user to their vaults", async () => {
    mocks.loadApplicationUser.mockResolvedValue({ canAccessApplication: () => true });

    await HomePage({ searchParams: Promise.resolve({}) });

    expect(mocks.redirect).toHaveBeenCalledWith("/vaults");
  });

  it.each([
    ["signed-out", null],
    ["inactive", { canAccessApplication: () => false }]
  ])("keeps the sign-in page public for a %s user", async (_scenario, user) => {
    mocks.loadApplicationUser.mockResolvedValue(user);

    await HomePage({ searchParams: Promise.resolve({}) });

    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
