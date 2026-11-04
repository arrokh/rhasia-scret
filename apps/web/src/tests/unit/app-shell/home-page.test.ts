import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/i18n/locale-switcher", () => ({ LocaleSwitcher: () => null }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => "/landing",
}));
import LandingPage from "@/app/landing/page";

describe("LandingPage", () => {
  it("presents the public product landing page with local and hosted Vault calls to action", async () => {
    const page = await LandingPage();
    const markup = renderToStaticMarkup(createElement("div", null, page));

    expect(markup).toContain("rhasia-");
    expect(markup).toContain("scret");
    expect(markup).toContain("Authenticator, sesuai pilihan Anda.");
    expect(markup).toContain("Layar yang sama dengan aplikasi.");
    expect(markup).toContain("Mulai dengan akun contoh.");
    expect(markup).toContain("data-landing-header");
    expect(markup).toContain('aria-label="Navigasi utama"');
    const header = markup.match(/<header\b[^>]*data-landing-header[^>]*>[\s\S]*?<\/header>/)?.[0];
    expect(header).toBeDefined();
    expect(header).not.toContain('href="/sign-in"');
    expect(header).not.toContain('href="/local?from=landing"');
    expect(header).toContain('href="https://github.com/arrokh/rhasia-scret"');
    expect(markup).toContain('href="/sign-in"');
    expect(markup).toContain('href="/local?from=landing"');
    expect(markup).toContain('href="https://nooroctavian.id/"');
    expect(markup).toContain('href="/privacy"');
    expect(markup).toContain('href="/support"');
    expect(markup).toContain(">Coba Local Vault<");
    expect(markup).not.toContain("Alamat email yang diundang");
    expect(markup).not.toContain("comparison-flow-vault-anchor");
  });
});
