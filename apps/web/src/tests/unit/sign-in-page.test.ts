import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
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
vi.mock("@/modules/identity/presentation/invited-user-sign-in-form", () => ({
  InvitedUserSignInForm: () => createElement("form", { "aria-label": "Formulir masuk" })
}));

import SignInPage from "@/app/sign-in/page";

describe("SignInPage", () => {
  it("redirects an authenticated active user to their vaults", async () => {
    mocks.loadApplicationUser.mockResolvedValue({ canAccessApplication: () => true });

    await SignInPage({ searchParams: Promise.resolve({}) });

    expect(mocks.redirect).toHaveBeenCalledWith("/vaults");
  });

  it.each([
    ["signed-out", null],
    ["inactive", { canAccessApplication: () => false }]
  ])("keeps sign in public for a %s user", async (_scenario, user) => {
    mocks.loadApplicationUser.mockResolvedValue(user);

    await SignInPage({ searchParams: Promise.resolve({}) });

    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("preserves logout notices, invite-only sign in, and offline access", async () => {
    mocks.loadApplicationUser.mockResolvedValue(null);

    const page = await SignInPage({ searchParams: Promise.resolve({ auth: ["signed_out", "ignored"] }) });
    const markup = renderToStaticMarkup(createElement("div", null, page));

    expect(markup).toContain("Anda telah keluar.");
    expect(markup).toContain('aria-label="Formulir masuk"');
    expect(markup).toContain('href="/offline"');
    expect(markup).toContain("Akses hanya tersedia melalui undangan");
    expect(markup.indexOf('data-slot="separator"')).toBeLessThan(markup.indexOf('href="/offline"'));
  });
});
