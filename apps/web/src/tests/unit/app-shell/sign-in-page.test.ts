import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadServerVaultPageContext: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/shared/infrastructure/server-api-gateway", () => ({
  loadServerVaultPageContext: mocks.loadServerVaultPageContext,
}));
vi.mock("@/modules/identity/presentation/email-sign-in-form", () => ({
  EmailSignInForm: ({ nextPath }: { nextPath: string }) =>
    createElement("form", { "aria-label": "Formulir masuk", "data-next-path": nextPath }),
}));

import SignInPage from "@/app/sign-in/page";

describe("SignInPage", () => {
  it("redirects an authenticated user to their vaults", async () => {
    mocks.loadServerVaultPageContext.mockResolvedValue({
      user: { id: "user", email: "user@example.test", status: "ACTIVE" },
    });
    await SignInPage({ searchParams: Promise.resolve({}) });
    expect(mocks.redirect).toHaveBeenCalledWith("/vaults");
  });

  it("returns an authenticated invitation recipient to redemption", async () => {
    mocks.loadServerVaultPageContext.mockResolvedValue({
      user: { id: "user", email: "user@example.test", status: "ACTIVE" },
    });
    await SignInPage({ searchParams: Promise.resolve({ next: "/vaults/invitations/redeem" }) });
    expect(mocks.redirect).toHaveBeenCalledWith("/vaults/invitations/redeem");
  });

  it("keeps sign in public when the API has no authenticated user", async () => {
    mocks.loadServerVaultPageContext.mockResolvedValue(null);
    await SignInPage({ searchParams: Promise.resolve({}) });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("preserves logout notices, email sign in, and offline access", async () => {
    mocks.loadServerVaultPageContext.mockResolvedValue(null);
    const page = await SignInPage({ searchParams: Promise.resolve({ auth: ["signed_out", "ignored"] }) });
    const markup = renderToStaticMarkup(createElement("div", null, page));
    expect(markup).toContain("Anda telah keluar.");
    expect(markup).toContain('aria-label="Formulir masuk"');
    expect(markup).toContain('href="/offline"');
    expect(markup).toContain("Masuk atau buat akun dengan alamat email terverifikasi.");
  });
});
