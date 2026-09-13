import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/i18n/locale-switcher", () => ({ LocaleSwitcher: () => null }));
const mocks = vi.hoisted(() => ({ redirect: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, usePathname: () => "/" }));

import LandingPage from "@/app/page";

describe("LandingPage", () => {
  it("forwards a provider callback that landed on the root page to the auth callback", async () => {
    await LandingPage({ searchParams: Promise.resolve({ code: "provider-code" }) });

    expect(mocks.redirect).toHaveBeenCalledWith("/auth/confirm?code=provider-code");
  });

  it("maps an expired provider link to a safe sign-in notice without echoing its description", async () => {
    await LandingPage({
      searchParams: Promise.resolve({
        error: "access_denied",
        error_code: "otp_expired",
        error_description: "<script>alert('attacker')</script>",
        next: "/vaults/invitations/redeem",
      }),
    });

    expect(mocks.redirect).toHaveBeenCalledWith("/sign-in?auth=link_expired&next=%2Fvaults%2Finvitations%2Fredeem");
  });

  it("presents the public product landing page with local and hosted Vault calls to action", async () => {
    const page = await LandingPage();
    const markup = renderToStaticMarkup(createElement("div", null, page));

    expect(markup).toContain("rhasia-");
    expect(markup).toContain("scret");
    expect(markup).toContain("Autentikator Anda, sesuai ketentuan Anda");
    expect(markup).toContain("Apa itu rhasia-scret?");
    expect(markup).toContain("Jalur yang disengaja");
    expect(markup).toContain("Browser Anda");
    expect(markup).toContain('href="/sign-in"');
    expect(markup).toContain('href="/local?from=landing"');
    expect(markup).toContain('href="/sign-in"');
    expect(markup).toContain('href="https://nooroctavian.id/"');
    expect(markup).toContain('href="/privacy"');
    expect(markup).toContain('href="/support"');
    expect(markup).toContain(">Coba Local Vault<");
    expect(markup).not.toContain("Alamat email yang diundang");
    expect(markup).not.toContain("comparison-flow-vault-anchor");
  });
});
